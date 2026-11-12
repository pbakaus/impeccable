//! Byte-range fallback for elements that share source lines with markup.
use super::*;

struct Token {
    start: usize,
    end: usize,
    name: String,
    close: bool,
    single: bool,
    parent: Option<usize>,
}

fn block(name: &str) -> bool {
    matches!(name, "address" | "article" | "aside" | "blockquote" | "details" | "dialog" | "div" | "dl" | "fieldset" | "figcaption" | "figure" | "footer" | "form" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "header" | "hgroup" | "hr" | "li" | "main" | "nav" | "ol" | "p" | "section" | "table" | "ul" | "body")
}

fn raw(name: &str) -> bool {
    matches!(name, "pre" | "textarea" | "script" | "style")
}

fn tokens(source: &str) -> Vec<Token> {
    let bytes = source.as_bytes();
    let mut out: Vec<Token> = Vec::new();
    let mut stack: Vec<usize> = Vec::new();
    let mut i = 0;
    // Astro frontmatter is executable source, not markup.
    if source.starts_with("---\n") {
        if let Some(end) = source[4..].find("\n---") { i = end + 8; }
    }
    while i < bytes.len() {
        if source.is_char_boundary(i) && source[i..].starts_with("{/*") {
            i = source[i + 3..].find("*/}").map_or(bytes.len(), |n| i + 3 + n + 3);
            continue;
        }
        if bytes[i] != b'<' { i += 1; continue; }
        if source[i..].starts_with("<!--") {
            i = source[i + 4..].find("-->").map_or(bytes.len(), |n| i + 4 + n + 3);
            continue;
        }
        let start = i;
        i += 1;
        let close = bytes.get(i) == Some(&b'/');
        if close { i += 1; }
        let ns = i;
        while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || b"-:._".contains(&bytes[i])) { i += 1; }
        if ns == i || !bytes[ns].is_ascii_alphabetic() { continue; }
        let name = source[ns..i].to_string();
        let mut quote = None;
        let mut braces = 0usize;
        while i < bytes.len() {
            let c = bytes[i];
            if let Some(q) = quote {
                if c == b'\\' && braces > 0 { i += 2; continue; }
                if c == q { quote = None; }
            } else if b"\"'`".contains(&c) { quote = Some(c); }
            else if c == b'{' { braces += 1; }
            else if c == b'}' { braces = braces.saturating_sub(1); }
            else if c == b'>' && braces == 0 { break; }
            i += 1;
        }
        if i >= bytes.len() { break; }
        i += 1;
        let lower = name.to_ascii_lowercase();
        let single = source[start..i].trim_end_matches('>').trim_end().ends_with('/')
            || matches!(lower.as_str(), "area" | "base" | "br" | "col" | "embed" | "hr" | "img" | "input" | "link" | "meta" | "param" | "source" | "track" | "wbr");
        let parent = stack.last().copied();
        if close {
            if let Some(p) = stack.iter().rposition(|p| out[*p].name.eq_ignore_ascii_case(&name)) { stack.truncate(p); }
        }
        out.push(Token { start, end: i, name, close, single, parent });
        if !close && !single { stack.push(out.len() - 1); }
    }
    out
}

fn raw_text_parent(ts: &[Token], token: &Token) -> Option<usize> {
    let mut parent = token.parent;
    while let Some(p) = parent {
        if matches!(ts[p].name.to_ascii_lowercase().as_str(), "script" | "style" | "textarea") {
            return Some(p);
        }
        parent = ts[p].parent;
    }
    None
}

struct Candidate {
    file: usize,
    start: usize,
    end: usize,
    range: ElementMatch,
    shared: bool,
    safe: bool,
}

/// Only takes over when a locator candidate actually shares a boundary line.
/// Otherwise the established line resolver and its output remain unchanged.
pub(super) fn resolve(files: Vec<SourceFile>, queries: &[String], tag: Option<&str>, text: Option<&str>) -> Result<Resolution, Vec<SourceFile>> {
    let mut candidates = Vec::new();
    for (fi, file) in files.iter().enumerate() {
        let source = file.lines.join("\n");
        let ts = tokens(&source);
        for (ti, t) in ts.iter().enumerate().filter(|(_, t)| !t.close) {
            if tag.map_or(false, |tag| !tag.eq_ignore_ascii_case(&t.name)) { continue; }
            if source[t.start..t.end].contains("data-impeccable-variant") { continue; }
            let end = if t.single { t.end } else {
                let mut depth = 1;
                let mut end = None;
                for next in &ts[ti + 1..] {
                    // Markup-looking strings in raw text do not nest the outer element.
                    if raw_text_parent(&ts, next) != raw_text_parent(&ts, t)
                        && !raw(&t.name.to_ascii_lowercase()) {
                        continue;
                    }
                    if next.name.eq_ignore_ascii_case(&t.name) {
                        if next.close { depth -= 1; } else if !next.single { depth += 1; }
                        if depth == 0 { end = Some(next.end); break; }
                    }
                }
                let Some(end) = end else { continue }; end
            };
            let opener_query = queries.iter().find(|q| ts.iter().any(|n| !n.close
                && tag.map_or(true, |tag| tag.eq_ignore_ascii_case(&n.name))
                && matches_query(&source[n.start..n.end], q, tag)));
            let query_matches = if let Some(q) = opener_query {
                matches_query(&source[t.start..t.end], q, tag)
            } else {
                queries.iter().any(|q| source[t.end..end].contains(q)
                    && !ts[ti + 1..].iter().any(|n| !n.close && n.start < end
                        && source[n.start..end].contains(q)))
            };
            if !query_matches { continue; }
            let ls = source[..t.start].rfind('\n').map_or(0, |n| n + 1);
            let le = source[end..].find('\n').map_or(source.len(), |n| end + n);
            let before = &source[ls..t.start];
            let after = &source[end..le];
            let shared = !before.trim().is_empty() || !after.trim().is_empty();
            let mut ancestor = t.parent;
            let mut protected = raw(&t.name.to_ascii_lowercase());
            while let Some(p) = ancestor {
                protected |= raw(&ts[p].name.to_ascii_lowercase());
                ancestor = ts[p].parent;
            }
            let text_before = before.rsplit('>').next().unwrap_or(before).trim();
            let text_after = after.split('<').next().unwrap_or(after).trim();
            let neighbours_block = ts.iter().filter(|n| n.end <= t.start && n.end > ls).last()
                .map_or(true, |n| block(&n.name.to_ascii_lowercase()))
                && ts.iter().find(|n| n.start >= end && n.start < le)
                    .map_or(true, |n| block(&n.name.to_ascii_lowercase()));
            let jsx = matches!(jsp::extname(&file.path).as_str(), ".jsx" | ".tsx");
            let safe = jsx || (!protected && text_before.is_empty() && text_after.is_empty()
                && (block(&t.name.to_ascii_lowercase()) || t.parent.map_or(false, |p| ts[p].name.eq_ignore_ascii_case("body")) || neighbours_block));
            candidates.push(Candidate { file: fi, start: t.start, end,
                range: ElementMatch { start_line: source[..t.start].matches('\n').count(), end_line: Some(source[..end].matches('\n').count()) }, shared, safe });
        }
    }
    if !candidates.iter().any(|c| c.shared) { return Err(files); }
    if let Some(text) = text.filter(|t| !t.trim().is_empty()) {
        let normalize = |s: &str| WS_RUN_RE.replace_all(&s.to_lowercase(), " ").trim().to_string();
        let wanted = normalize(text);
        let filtered: Vec<_> = candidates.iter().enumerate().filter_map(|(i, c)| {
            let source = files[c.file].lines.join("\n");
            let inner = TAG_RE.replace_all(&source[c.start..c.end], " ");
            let actual = normalize(&inner);
            (actual == wanted || (text_disambiguates(text) && actual.contains(&wanted))).then_some(i)
        }).collect();
        if !filtered.is_empty() {
            candidates = candidates.into_iter().enumerate().filter_map(|(i, c)| filtered.contains(&i).then_some(c)).collect();
        } else if candidates.len() > 1 {
            let hits = candidates.iter().map(|c| (files[c.file].path.clone(), vec![c.range])).collect();
            return Ok(Resolution::TextInNoFile(hits));
        }
    }
    if candidates.len() != 1 {
        let hits = candidates.iter().map(|c| (files[c.file].path.clone(), vec![c.range])).collect();
        return Ok(Resolution::AmbiguousFiles(hits));
    }
    let c = candidates.remove(0);
    let mut file = files.into_iter().nth(c.file).unwrap();
    if !c.shared { return Ok(Resolution::Match(file, c.range)); }
    if !c.safe { return Ok(Resolution::Inline(file.path)); }
    let source = file.lines.join("\n");
    let ls = source[..c.start].rfind('\n').map_or(0, |n| n + 1);
    let le = source[c.end..].find('\n').map_or(source.len(), |n| c.end + n);
    let before = &source[ls..c.start];
    let after = &source[c.end..le];
    let indent = leading_ws(&source[ls..]);
    let mut replacement = Vec::new();
    if !before.trim().is_empty() { replacement.push(before.trim_end().to_string()); }
    let start_line = c.range.start_line + replacement.len();
    let extra = if replacement.is_empty() { "" } else { "  " };
    replacement.push(format!("{}{}{}", indent, extra, &source[c.start..c.end]));
    let end_line = start_line + source[c.start..c.end].matches('\n').count();
    if !after.trim().is_empty() { replacement.push(format!("{}{}", indent, after)); }
    let content = format!("{}{}{}", &source[..ls], replacement.join("\n"), &source[le..]);
    file.lines = content.split('\n').map(String::from).collect();
    file.isolation = Some((c.range.start_line, c.range.end_line.unwrap(),
        c.range.start_line + replacement.join("\n").matches('\n').count()));
    Ok(Resolution::Match(file, ElementMatch { start_line, end_line: Some(end_line) }))
}
