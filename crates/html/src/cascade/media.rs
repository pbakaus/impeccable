//! Static scans use the default rendered environment: screen, light, 1280×800.
//! Unknown queries never contribute styles, including when negated. Filtering
//! keeps byte offsets/newlines and leaves the frozen rule collector unchanged.
use cssparser::{Delimiter, Parser, ParserInput, Token};
use std::ops::Range;

const WIDTH: f64 = 1280.0;
const HEIGHT: f64 = 800.0;

#[derive(Debug)]
enum Term {
    Ident(String),
    Length(f64),
    Mark(char),
    Group(Vec<Term>),
    Unknown,
}

fn terms(input: &mut Parser<'_, '_>, depth: usize) -> Vec<Term> {
    let mut out = Vec::new();
    while let Ok(token) = input.next().cloned() {
        out.push(match token {
            Token::Ident(s) => Term::Ident(s.to_ascii_lowercase()),
            Token::Number { value, .. } if value == 0.0 => Term::Length(0.0),
            Token::Dimension { value, unit, .. } => {
                let scale = match unit.to_ascii_lowercase().as_str() {
                    "px" => 1.0,
                    // Media-query font units use the initial font size.
                    "em" | "rem" => 16.0,
                    _ => {
                        out.push(Term::Unknown);
                        continue;
                    }
                };
                Term::Length(f64::from(value) * scale)
            }
            Token::Colon => Term::Mark(':'),
            Token::Delim(c) => Term::Mark(c),
            Token::ParenthesisBlock if depth < 32 => {
                let nested: Result<_, cssparser::ParseError<'_, ()>> =
                    input.parse_nested_block(|p| Ok(terms(p, depth + 1)));
                match nested {
                    Ok(t) => Term::Group(t),
                    Err(_) => Term::Unknown,
                }
            }
            _ => Term::Unknown,
        });
    }
    out
}

fn ident(t: &Term, name: &str) -> bool {
    matches!(t, Term::Ident(s) if s == name)
}

fn dimension(t: &Term) -> Option<f64> {
    match t {
        Term::Ident(s) if s == "width" => Some(WIDTH),
        Term::Ident(s) if s == "height" => Some(HEIGHT),
        // A negative media length is valid; compare it with the viewport.
        Term::Length(n) if n.is_finite() => Some(*n),
        _ => None,
    }
}

fn comparison(left: f64, op: &[Term], right: f64) -> Option<bool> {
    match op {
        [Term::Mark('=')] => Some(left == right),
        [Term::Mark('<')] => Some(left < right),
        [Term::Mark('>')] => Some(left > right),
        [Term::Mark('<'), Term::Mark('=')] => Some(left <= right),
        [Term::Mark('>'), Term::Mark('=')] => Some(left >= right),
        _ => None,
    }
}

fn feature(t: &[Term]) -> Option<bool> {
    match t {
        // These supported features have no zero/none value in this environment.
        // https://www.w3.org/TR/mediaqueries-5/#mq-boolean-context
        [Term::Ident(name)]
            if matches!(
                name.as_str(),
                "width" | "height" | "orientation" | "prefers-color-scheme"
            ) =>
        {
            Some(true)
        }
        [Term::Ident(name), Term::Mark(':'), Term::Ident(value)] => match name.as_str() {
            "prefers-color-scheme" => match value.as_str() {
                "light" => Some(true),
                "dark" => Some(false),
                _ => None,
            },
            "orientation" => match value.as_str() {
                "landscape" => Some(true),
                "portrait" => Some(false),
                _ => None,
            },
            _ => None,
        },
        [Term::Ident(name), Term::Mark(':'), value @ Term::Length(_)] => {
            let (kind, key) = if let Some(s) = name.strip_prefix("min-") {
                (1, s)
            } else if let Some(s) = name.strip_prefix("max-") {
                (-1, s)
            } else {
                (0, name.as_str())
            };
            let actual = match key {
                "width" => WIDTH,
                "height" => HEIGHT,
                _ => return None,
            };
            let expected = dimension(value)?;
            Some(match kind {
                1 => actual >= expected,
                -1 => actual <= expected,
                _ => actual == expected,
            })
        }
        _ => {
            // Range syntax: width >= 80em; 1000px < width <= 1280px.
            let indices: Vec<usize> = t
                .iter()
                .enumerate()
                .filter_map(|(i, v)| dimension(v).map(|_| i))
                .collect();
            if !matches!(indices.len(), 2 | 3) || indices[0] != 0 || *indices.last()? != t.len() - 1
            {
                return None;
            }
            let features: Vec<usize> = indices
                .iter()
                .copied()
                .filter(|&i| matches!(&t[i], Term::Ident(_)))
                .collect();
            if features.len() != 1 || (indices.len() == 3 && features[0] != indices[1]) {
                return None;
            }
            if indices.len() == 3 {
                let first = &t[1];
                let second = &t[indices[1] + 1];
                if !matches!(
                    (first, second),
                    (Term::Mark('<'), Term::Mark('<')) | (Term::Mark('>'), Term::Mark('>'))
                ) {
                    return None;
                }
            }
            let mut result = true;
            for pair in indices.windows(2) {
                result &= comparison(
                    dimension(&t[pair[0]])?,
                    &t[pair[0] + 1..pair[1]],
                    dimension(&t[pair[1]])?,
                )?;
            }
            Some(result)
        }
    }
}

fn condition(t: &[Term]) -> Option<bool> {
    match t {
        [Term::Group(inner)] => feature(inner).or_else(|| condition(inner)),
        [not, Term::Group(inner)] if ident(not, "not") => {
            Some(!feature(inner).or_else(|| condition(inner))?)
        }
        _ => {
            if t.len() < 3 || t.len() % 2 == 0 {
                return None;
            }
            let is_and = ident(&t[1], "and");
            if !is_and && !ident(&t[1], "or") {
                return None;
            }
            let mut value = condition(&t[..1])?;
            for chunk in t[1..].chunks_exact(2) {
                if !ident(&chunk[0], if is_and { "and" } else { "or" }) {
                    return None;
                }
                let next = condition(&chunk[1..])?;
                value = if is_and { value && next } else { value || next };
            }
            Some(value)
        }
    }
}

/// Evaluate a nonempty media query list. Callers handle absent/empty attributes.
pub fn matches_media(query: &str) -> bool {
    let mut source = ParserInput::new(query);
    let mut input = Parser::new(&mut source);
    loop {
        let parsed: Result<_, cssparser::ParseError<'_, ()>> =
            input.parse_until_before(Delimiter::Comma, |p| Ok(terms(p, 0)));
        if parsed.is_ok_and(|t| matches_query(&t)) {
            return true;
        }
        if input.expect_comma().is_err() {
            return false;
        }
    }
}

fn matches_query(t: &[Term]) -> bool {
    let mut index = 0;
    let negate = t.first().is_some_and(|t| ident(t, "not"));
    if t.first().is_some_and(|t| ident(t, "only")) || negate {
        index += 1;
    }
    if let Some(Term::Ident(media)) = t.get(index) {
        if matches!(media.as_str(), "and" | "or" | "not" | "only") {
            return false;
        }
        let media_matches = media == "screen" || media == "all";
        index += 1;
        let rest = if index == t.len() {
            Some(true)
        } else if ident(&t[index], "and") && !t[index + 1..].iter().any(|v| ident(v, "or")) {
            // A media type permits a condition-without-or. Nested or is valid.
            condition(&t[index + 1..])
        } else {
            None
        };
        rest.is_some_and(|rest| {
            if negate {
                !(media_matches && rest)
            } else {
                media_matches && rest
            }
        })
    } else {
        condition(&t) == Some(true)
    }
}

fn inactive_ranges(input: &mut Parser<'_, '_>, ranges: &mut Vec<Range<usize>>, depth: usize) {
    while !input.is_exhausted() {
        let start = input.position();
        let Ok(token) = input.next_including_whitespace_and_comments().cloned() else {
            break;
        };
        let mut keep = depth < 64;
        if matches!(&token, Token::AtKeyword(name) if name.eq_ignore_ascii_case("media")) {
            let prelude = input.position();
            let _: Result<(), cssparser::ParseError<'_, ()>> = input.parse_until_before(
                Delimiter::CurlyBracketBlock | Delimiter::Semicolon,
                |p| {
                    while p.next_including_whitespace_and_comments().is_ok() {}
                    Ok(())
                },
            );
            keep = keep && matches_media(input.slice_from(prelude));
            if !matches!(input.next(), Ok(Token::CurlyBracketBlock)) {
                continue;
            }
        } else if !matches!(token, Token::CurlyBracketBlock) {
            continue;
        }
        let _: Result<(), cssparser::ParseError<'_, ()>> = input.parse_nested_block(|p| {
            if keep && depth < 64 {
                inactive_ranges(p, ranges, depth + 1);
            } else {
                while p.next_including_whitespace_and_comments().is_ok() {}
            }
            Ok(())
        });
        if !keep {
            ranges.push(start.byte_index()..input.position().byte_index());
        }
    }
}

pub fn screen_styles(css: &str) -> String {
    let mut source = ParserInput::new(css);
    let mut ranges = Vec::new();
    inactive_ranges(&mut Parser::new(&mut source), &mut ranges, 0);
    let mut bytes = css.as_bytes().to_vec();
    for range in ranges {
        for byte in &mut bytes[range] {
            if *byte != b'\n' && *byte != b'\r' {
                *byte = b' ';
            }
        }
    }
    String::from_utf8(bytes).expect("only whole CSS token ranges are replaced")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_grammar_and_unknown_negation() {
        for query in [
            "SCREEN and ( width : 1280px )",
            "screen/**/and (width:80rem)",
            "screen/* , ( */ and (width:80rem)",
            "not print",
            "not screen and (max-width:500px)",
            "not (prefers-color-scheme:dark)",
            "(width)",
            "(height:800px)",
            "(orientation:landscape)",
            "(1280px >= width > 1000px)",
            "((min-width:80em) and (prefers-color-scheme:light))",
            "(width > 2000px) or (width <= 1280px)",
        ] {
            assert!(matches_media(query), "{query}");
        }
        for query in [
            "",
            "only",
            "not",
            "screen and",
            "screen nonsense",
            "screen or (width)",
            "screen and (width) or (height)",
            "(prefers-reduced-motion:no-preference)",
            "not (prefers-reduced-motion:reduce)",
            "(prefers-color-scheme:dark)",
            "(height > 800px)",
            "(orientation:portrait)",
            "(width:calc(100px + 1180px))",
            "(width:1vw)",
            "not (unknown:yes)",
            "not screen and (unknown:yes)",
            "(width == 1280px)",
            "(1000px < width > 500px)",
            "(width < 2000px < 3000px)",
            "(width) and (height) or (width)",
        ] {
            assert!(!matches_media(query), "{query}");
        }
    }

    #[test]
    fn negative_dimensions_are_comparable_not_unknown() {
        for query in [
            "(width > -1px)",
            "not (max-width: -1px)",
            "(height >= -1em)",
            "(-1rem < width <= 80rem)",
            "(min-height: -10px)",
            "not (height: -1px)",
        ] {
            assert!(matches_media(query), "{query}");
        }
        for query in [
            "(width: -1px)",
            "(max-width: -1px)",
            "(height < -1em)",
            "(-2px < width < -1px)",
            "not (min-height: -1px)",
            "not (width: -1vw)",
        ] {
            assert!(!matches_media(query), "{query}");
        }
    }

    #[test]
    fn filtering_preserves_offsets_strings_comments_and_unrelated_at_rules() {
        let keep = "/* @media print { } */ .a{content:'@media print {é}';background:url('x{y}') } @font-face{font-family:a;src:url(a)} @keyframes move{from{opacity:0}to{opacity:1}}";
        assert_eq!(screen_styles(keep), keep);
        let css = format!("{keep}\n@MEDIA print{{.a{{color:red;content:'é'}}}}\n.b{{color:blue}}");
        let filtered = screen_styles(&css);
        assert_eq!(filtered.len(), css.len());
        assert_eq!(filtered.lines().count(), css.lines().count());
        assert!(filtered.starts_with(keep));
        assert!(filtered.ends_with("\n.b{color:blue}"));
        assert!(!filtered.contains("color:red"));
        assert!(!screen_styles("@m\\65 dia print{.a{color:red}}").contains("color:red"));
    }
}
