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

/// `fold_case` is true for plain HTML, where `<IMG>` is the void `img`. In a
/// file that can hold components (JSX, Vue, Svelte, Astro) `<Link>` and
/// `<Input>` are components, so only a lowercase name is an HTML void.
/// `skip_comments` is false for a source `mask_source` already blanked: its
/// lexer knows which `<!--` or `{/*` opens a comment and which sits in a JS
/// string.
fn tokens(source: &str, fold_case: bool, skip_comments: bool) -> Vec<Token> {
    let bytes = source.as_bytes();
    let mut out: Vec<Token> = Vec::new();
    let mut stack: Vec<usize> = Vec::new();
    let mut i = 0;
    // Astro frontmatter is executable source, not markup.
    if let Some(opener_len) = source.strip_prefix("---\r\n").map(|_| 5)
        .or_else(|| source.strip_prefix("---\n").map(|_| 4)) {
        // Matching from LF also covers CRLF without changing byte offsets.
        if let Some(end) = source[opener_len..].find("\n---") { i = opener_len + end + 4; }
    }
    while i < bytes.len() {
        if skip_comments && source.is_char_boundary(i) && source[i..].starts_with("{/*") {
            i = source[i + 3..].find("*/}").map_or(bytes.len(), |n| i + 3 + n + 3);
            continue;
        }
        if bytes[i] != b'<' { i += 1; continue; }
        if skip_comments && source[i..].starts_with("<!--") {
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
        let html_name = if fold_case { lower.as_str() } else { name.as_str() };
        let single = source[start..i].trim_end_matches('>').trim_end().ends_with('/')
            || matches!(html_name, "area" | "base" | "br" | "col" | "embed" | "hr" | "img" | "input" | "link" | "meta" | "param" | "source" | "track" | "wbr");
        let parent = stack.last().copied();
        if close {
            if let Some(p) = stack.iter().rposition(|p| out[*p].name.eq_ignore_ascii_case(&name)) { stack.truncate(p); }
        }
        let raw_text = !close && !single && matches!(html_name, "script" | "style" | "textarea");
        out.push(Token { start, end: i, name, close, single, parent });
        if !close && !single { stack.push(out.len() - 1); }
        // Raw-text contents are not markup: skip to the element's own close.
        if raw_text {
            let closer = format!("</{}", lower);
            let rest = source[i..].to_ascii_lowercase();
            i = rest.match_indices(&closer)
                .find(|(n, _)| rest[n + closer.len()..].starts_with(|c: char| c == '>' || c.is_whitespace() || c == '/'))
                .map_or(bytes.len(), |(n, _)| i + n);
        }
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

/// Whether an opening tag holds another element (`icon={<Icon />}`): a second
/// tag the shared lexer opens. `{...}` reads as JS there, so `MouseEvent<T>`
/// is a generic and quoted text is not markup; `opener` comes masked, and a
/// lexer that loses its place or misses the opener (`<Foo{...p}>`) fails closed.
fn holds_nested_element(opener: &str) -> bool {
    let lines: Vec<String> = opener.split('\n').map(String::from).collect();
    let mut opens = 0;
    let clean = lex_markup(&lines, 0, Dialect::Jsx, true, false, |e| {
        if matches!(e, Lexed::Open { .. }) { opens += 1; }
        opens > 1
    });
    // The lexer opens no typed element (`<Icon<Props> />`), so refuse one
    // where JSX can start; `go<Array<T>>()` is a type argument.
    let typed = opener.match_indices('<').any(|(i, _)| {
        let name = opener[i + 1..].split(|c: char| !c.is_ascii_alphanumeric() && !"._:-".contains(c)).next().unwrap_or("");
        let before = opener[..i].trim_end();
        let word = before.rsplit(|c: char| !c.is_alphanumeric() && c != '_' && c != '$').next().unwrap_or("");
        name.starts_with(|c: char| c.is_ascii_alphabetic()) && opener[i + 1 + name.len()..].starts_with('<')
            && expects_operand(before.chars().last(), word)
    });
    typed || opens != 1 || !clean
}

struct Candidate {
    file: usize,
    rank: usize,
    start: usize,
    end: usize,
    range: ElementMatch,
    shared: bool,
    safe: bool,
    component: bool,
}

/// Only takes over when a locator candidate actually shares a boundary line.
/// Otherwise the established line resolver and its output remain unchanged.
pub(super) fn resolve(files: Vec<SourceFile>, queries: &[String], tag: Option<&str>, text: Option<&str>) -> Result<Resolution, Vec<SourceFile>> {
    let mut candidates = Vec::new();
    let tag_only = is_tag_only_search(queries, tag);
    for (fi, file) in files.iter().enumerate() {
        let source = file.lines.join("\n");
        // A file that cannot hold the locator is never tokenized.
        if !queries.iter().any(|q| source.contains(q.as_str()) || matches_query(&source, q, tag)) {
            continue;
        }
        let dialect = Dialect::of(&file.path);
        let jsx = dialect == Dialect::Jsx;
        // Isolation must not admit JSX that the scaffold would emit as HTML.
        let scaffold_supported = !jsx
            || crate::inject::resolve_source_traits(&file.path).comment_syntax == "jsx";
        let components = dialect != Dialect::Html;
        // Tokens are read from the masked source, whose byte offsets match
        // `source`; when the lexer cannot finish, from `source` itself.
        let masked = mask_source(&file.lines, dialect);
        let ts = match &masked {
            Some(masked) => tokens(masked, !components, false),
            None => tokens(&source, !components, true),
        };
        // Pair each opener with its own closer before matching inner text.
        let ends: Vec<_> = ts.iter().enumerate().map(|(ti, t)| {
            if t.close { return None; }
            if t.single { return Some(t.end); }
            let mut depth = 1;
            for next in &ts[ti + 1..] {
                if raw_text_parent(&ts, next) != raw_text_parent(&ts, t)
                    && !raw(&t.name.to_ascii_lowercase()) {
                    continue;
                }
                if next.name.eq_ignore_ascii_case(&t.name) {
                    if next.close { depth -= 1; } else if !next.single { depth += 1; }
                    if depth == 0 { return Some(next.end); }
                }
            }
            None
        }).collect();
        // A component can render the tag (see `component_fallback`), located
        // through its own opening tag, which must hold no nested element.
        for components_pass in [false, true] {
            if components_pass && !component_fallback_allowed(queries, tag, dialect) { break; }
            // The first pass took the elements of the tag itself.
            let accepts = |n: &Token| tag.map_or(true, |tag| renders_tag(&n.name, tag, components_pass) && !(components_pass && renders_tag(&n.name, tag, false)))
                && !(components_pass && holds_nested_element(&masked.as_deref().unwrap_or(&source)[n.start..n.end]));
            let opener_query = queries.iter().position(|q| ts.iter().any(|n| !n.close
                && accepts(n)
                && matches_query(&source[n.start..n.end], q, tag)));
            for (ti, t) in ts.iter().enumerate().filter(|(_, t)| !t.close) {
                if !accepts(t) { continue; }
                if source[t.start..t.end].contains("data-impeccable-variant") { continue; }
                let Some(end) = ends[ti] else { continue };
                let rank = if let Some(rank) = opener_query {
                    matches_query(&source[t.start..t.end], &queries[rank], tag).then_some(rank)
                } else if components_pass {
                    None
                } else {
                    queries.iter().position(|q| source[t.end..end].match_indices(q.as_str()).any(|(offset, _)| {
                        let at = t.end + offset;
                        !ts[ti + 1..].iter().enumerate().any(|(i, n)| !n.close
                            && n.start < end && n.start <= at
                            && ends[ti + 1 + i].map_or(true, |child_end| at < child_end))
                    }))
                };
                let Some(rank) = rank else { continue };
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
                let is_block = |n: &Token| if components { block(&n.name) } else { block(&n.name.to_ascii_lowercase()) };
                // Check each inserted newline independently. A body parent alone
                // cannot make an adjacent pair of inline siblings whitespace-safe.
                let left_safe = before.trim().is_empty() || before.ends_with(char::is_whitespace)
                    || (is_block(t) && ts.iter().filter(|n| n.end <= t.start && n.end > ls).last()
                        .map_or(false, |n| is_block(n)));
                let right_safe = after.trim().is_empty() || after.starts_with(char::is_whitespace)
                    || (is_block(t) && ts.iter().find(|n| n.start >= end && n.start < le)
                        .map_or(false, |n| is_block(n)));
                // JSX drops whitespace that holds a newline, so a split is safe only
                // where the element touches a tag or an expression container (or the
                // line's edge): never next to text, a space, or a JS keyword such as
                // `return`, where a newline would end the statement.
                let jsx_left = before.trim().is_empty() || before.ends_with('>') || before.ends_with('}');
                let jsx_right = after.trim().is_empty() || after.starts_with('<') || after.starts_with('{');
                let safe = scaffold_supported && if jsx { !protected && jsx_left && jsx_right } else {
                    !protected && text_before.is_empty() && text_after.is_empty()
                        && left_safe && right_safe
                };
                candidates.push(Candidate { file: fi, rank, start: t.start, end,
                    range: ElementMatch { start_line: source[..t.start].matches('\n').count(), end_line: Some(source[..end].matches('\n').count()) }, shared, safe, component: components_pass });
            }
        }
    }
    let text = text.filter(|t| !t.trim().is_empty());
    let normalize = |s: &str| WS_RUN_RE.replace_all(&s.to_lowercase(), " ").trim().to_string();
    let carries_text = |files: &[SourceFile], c: &Candidate| text.map_or(false, |text| {
        let source = files[c.file].lines.join("\n");
        let actual = normalize(&TAG_RE.replace_all(&source[c.start..c.end], " "));
        let wanted = normalize(text);
        actual == wanted || (text_disambiguates(text) && actual.contains(&wanted))
    });
    prefer_picked_tag(&mut candidates, |c| c.component, |c| carries_text(&files, c));
    // Locator precedence is global, before text or shared-line filtering can
    // discard a stronger hit in favour of another file's weaker locator.
    if let Some(rank) = candidates.iter().map(|c| c.rank).min() {
        candidates.retain(|c| c.rank == rank);
    }
    if !candidates.iter().any(|c| c.shared) { return Err(files); }
    if text.is_some() {
        if candidates.iter().any(|c| carries_text(&files, c)) {
            candidates.retain(|c| carries_text(&files, c));
        } else if candidates.len() > 1 {
            if !tag_only && candidates.iter().any(|c| !c.shared) {
                // The line resolver lands on the first hit in walk order; hand
                // back only when that hit stands on lines of its own.
                if !candidates[0].shared { return Err(files); }
                candidates.retain(|c| !c.shared);
            }
            let hits = candidates.iter().map(|c| (files[c.file].path.clone(), vec![c.range])).collect();
            return Ok(Resolution::TextInNoFile(hits));
        }
    }
    // A class, id or query locator keeps the line resolver's first hit in
    // ordinary source: a minified copy elsewhere does not make it ambiguous.
    // A tag alone must still weigh every candidate.
    if !tag_only && candidates.len() > 1 && candidates.iter().any(|c| !c.shared) {
        // The line resolver would take the first hit in walk order, which may
        // be the minified line. Drop the shared hits instead; only a single
        // surviving lone hit may win, and several stay ambiguous.
        if !candidates[0].shared { return Err(files); }
        candidates.retain(|c| !c.shared);
    }
    if candidates.len() != 1 {
        let hits = candidates.iter().map(|c| (files[c.file].path.clone(), vec![c.range])).collect();
        return Ok(Resolution::AmbiguousFiles(hits));
    }
    let c = candidates.remove(0);
    let mut file = files.into_iter().nth(c.file).unwrap();
    if !c.shared { return Ok(Resolution::Match(file, c.range)); }
    if !c.safe { return Ok(Resolution::SharedLine(file, c.range)); }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn astro_crlf_frontmatter_does_not_create_markup_tokens() {
        let source = "---\r\nconst fake = \"<div>\";\r\n---\r\n<main><h1>Title</h1></main>";
        let ts = tokens(source, false, true);
        assert_eq!(ts.len(), 4);
        assert_eq!(ts[0].name, "main");
        assert_eq!(ts[0].start, source.find("<main>").unwrap());
        assert_eq!(&source[ts[1].start..ts[1].end], "<h1>");
        assert_eq!(ts.last().unwrap().end, source.len());
    }

    #[test]
    fn same_line_component_renders_the_picked_tag() {
        let file = |path: &str, text: &str| SourceFile { isolation: None, path: path.into(), lines: vec![text.to_string()] };
        let queries = build_search_queries(None, Some("demo-exit"), Some("a"), None);
        // #1583: Next's `<Link>` renders `a`, on a line it shares with `<nav>`.
        let link = r#"<nav><Link href="/journal" className="demo-exit">Leave demo</Link></nav>"#;
        let Resolution::Match(found, m) = resolve_in_file(file("app/page.tsx", link), &queries, Some("a"), Some("Leave demo")) else { panic!() };
        assert!(found.isolation.is_some());
        assert_eq!(found.lines[m.start_line].trim(), r#"<Link href="/journal" className="demo-exit">Leave demo</Link>"#);
        // An element of the picked tag on the same line wins.
        let both = r#"<nav><a className="demo-exit">A</a><Link className="demo-exit">B</Link></nav>"#;
        let Ok(Resolution::Match(found, m)) = resolve(vec![file("app/page.tsx", both)], &queries, Some("a"), None) else { panic!() };
        assert_eq!(found.lines[m.start_line].trim(), r#"<a className="demo-exit">A</a>"#);
        // Unless only the component carries the picked text, on one line or several.
        let both = r#"<nav><a className="demo-exit">Home</a><Link className="demo-exit">Leave demo</Link></nav>"#;
        let Resolution::Match(found, m) = resolve_in_file(file("app/page.tsx", both), &queries, Some("a"), Some("Leave demo")) else { panic!() };
        assert_eq!(found.lines[m.start_line].trim(), r#"<Link className="demo-exit">Leave demo</Link>"#);
        let lines = ["<nav>", r#"  <a className="demo-exit">Home</a>"#, r#"  <Link className="demo-exit">Leave demo</Link>"#, "</nav>"];
        let split = SourceFile { isolation: None, path: "app/page.tsx".into(), lines: lines.map(String::from).to_vec() };
        let Resolution::Match(found, m) = resolve_in_file(split, &queries, Some("a"), Some("Leave demo")) else { panic!() };
        assert_eq!(found.lines[m.start_line], lines[2]);
        // Or in another file.
        let exact = r#"<nav><a href="/x" className="demo-exit">Leave demo</a></nav>"#;
        let Ok(Resolution::Match(found, _)) = resolve(vec![file("components/Nav.tsx", link), file("app/page.tsx", exact)], &queries, Some("a"), None) else { panic!() };
        assert_eq!(found.path, "app/page.tsx");
        // Tag-like text in a quoted prop or a TS generic is not a nested element.
        for quoted in [r#"<nav><Link title={'<Back'} className="demo-exit">Leave demo</Link></nav>"#,
            r#"<nav><Link className="demo-exit" title="C:\">Leave demo</Link></nav>"#,
            r#"<nav><Link onClick={(e: MouseEvent<HTMLAnchorElement>) => go(e)} className="demo-exit">Leave demo</Link></nav>"#,
            r#"<nav><Link onClick={() => go<Array<string>>()} className="demo-exit">Leave demo</Link></nav>"#] {
            assert!(matches!(resolve(vec![file("app/page.tsx", quoted)], &queries, Some("a"), None), Ok(Resolution::Match(..))), "{quoted}");
        }
        // A nested element after a comment holding an apostrophe is still one.
        let commented = r#"<nav><Button icon={/* user's icon */ <Icon className="demo-exit" />}>X</Button></nav>"#;
        assert!(resolve(vec![file("app/page.tsx", commented)], &queries, Some("a"), None).is_err());
        // Not in HTML, not for a tag-only search, not through a nested element.
        let tag_only = [String::from("<a")];
        for (path, text, queries) in [
            ("index.html", link, &queries[..]),
            ("app/page.tsx", r#"<nav><abbr>x</abbr><Link href="/">y</Link></nav>"#, &tag_only[..]),
            ("app/page.tsx", r#"<nav><Button icon={<Icon className="demo-exit" />}>X</Button></nav>"#, &queries[..]),
            ("app/page.tsx", r#"<nav><Button icon={<Icon<Props> className="demo-exit" />}>X</Button></nav>"#, &queries[..]),
        ] {
            assert!(resolve(vec![file(path, text)], queries, Some("a"), None).is_err(), "{path}: {text}");
        }
    }
}
