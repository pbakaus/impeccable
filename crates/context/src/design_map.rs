//! A compact map of a long DESIGN.md, built by fixed code, that `context`
//! carries in place of the full file: its tokens, North Star, named rules,
//! Do and Don't leads, the files it points at, and where the full file is.

use crate::design_parser::parse_design_md;
use serde_json::Value;
use std::path::Path;

/// Bytes a document may take in `context` before it is carried as a map.
pub const MAP_BUDGET: usize = 1600;
/// Bytes the map itself may take (about 600 tokens): room for every rule of a large system, which the
/// guardrails need more than the long tail of its palette (REN-2129 gate, 17 Nov).
pub const MAP_SIZE: usize = 2400;
const COLOR_LINE_BUDGET: usize = 240;
const SCALE_LINE_BUDGET: usize = 200;
const MAX_MAP_PATHS: usize = 8;

/// The map of `design`, whose file is `path`; mentioned files are checked under `root`.
pub fn map(design: &str, root: &Path, path: &str) -> String {
    let fm = parse_design_md(design).frontmatter.unwrap_or_default();
    let mut head = Vec::new();
    if let Some(name) = fm.get("name").and_then(Value::as_str) {
        head.push(format!("Name: {name}"));
    }
    if let Some(world) = fm.get("world").and_then(Value::as_str) {
        head.push(format!("World: {world}"));
    }
    if let Some(colors) = fm.get("colors").and_then(Value::as_object) {
        let entries: Vec<String> = colors.iter().filter_map(|(k, v)| v.as_str().map(|v| format!("{k} {v}"))).collect();
        if !entries.is_empty() {
            head.push(capped_line("Colors: ", &entries, COLOR_LINE_BUDGET, "in the frontmatter"));
        }
    }
    if let Some(type_roles) = fm.get("typography").and_then(Value::as_object) {
        let mut families: Vec<(String, Vec<&str>)> = Vec::new();
        for (role, spec) in type_roles {
            let Some(family) = spec.get("fontFamily").and_then(Value::as_str) else { continue };
            let first = family.split(',').next().unwrap_or("").trim().trim_matches(['"', '\'']).to_string();
            match families.iter_mut().find(|(f, _)| *f == first) {
                Some((_, roles)) => roles.push(role),
                None => families.push((first, vec![role])),
            }
        }
        if !families.is_empty() {
            let fonts: Vec<String> = families.iter().map(|(f, roles)| format!("{f} ({})", roles.join(", "))).collect();
            head.push(format!("Fonts: {}", fonts.join("; ")));
        }
    }

    // The spacing and radius scales: off-scale values are what an agent gets wrong without them.
    for (key, label) in [("spacing", "Spacing: "), ("rounded", "Radius: ")] {
        if let Some(scale) = fm.get(key).and_then(Value::as_object) {
            let entries: Vec<String> = scale.iter().filter_map(|(k, v)| v.as_str().map(|v| format!("{k} {v}"))).collect();
            if !entries.is_empty() {
                head.push(capped_line(label, &entries, SCALE_LINE_BUDGET, "in the frontmatter"));
            }
        }
    }

    let body = body_lines(design);
    let mut rules = Vec::new();
    let mut dos = Vec::new();
    let mut donts = Vec::new();
    let mut paths: Vec<String> = Vec::new();
    let mut section = Section::Other;
    for line in &body {
        let t = line.trim();
        if t.starts_with('#') {
            section = Section::of(t.trim_start_matches('#').trim());
        }
        if let Some(star) = north_star(t) {
            head.push(format!("North Star: {star}"));
        } else if t.starts_with("Reference image:") {
            head.push(t.to_string());
        } else if let Some(rule) = named_rule(t) {
            rules.push(rule);
        } else if let Some(item) = t.strip_prefix("- ").or_else(|| t.strip_prefix("* ")) {
            let plain = item.replace("**", "");
            let kind = match section {
                Section::Do | Section::Dont => section,
                Section::Other => match plain.split_whitespace().next().map(|w| w.trim_end_matches([':', '.'])) {
                    Some("Don't" | "Don’t") => Section::Dont,
                    Some("Do") if plain.starts_with("Do not ") => Section::Dont,
                    Some("Do") => Section::Do,
                    _ => Section::Other,
                },
            };
            let lead = first_sentence(plain.trim());
            match kind {
                Section::Do => dos.push(lead),
                Section::Dont => donts.push(lead),
                Section::Other => {}
            }
        }
        for candidate in path_mentions(t) {
            if paths.len() < MAX_MAP_PATHS && !paths.contains(&candidate) && is_relative_path(&candidate) && root.join(&candidate).exists() {
                paths.push(candidate);
            }
        }
    }

    let mut tail: Vec<String> = paths.iter().map(|p| format!("Map: {p}")).collect();
    tail.push(format!("Full: {path} (read a section when you need its detail)"));
    // Over the cap, the Do bullets give way first (they mostly restate the rules), then the rules, and the Don'ts
    // last: each list keeps at least its first item and names what it dropped.
    let mut lists = [("Rules:", rules, 0usize), ("Don't:", donts, 0), ("Do:", dos, 0)];
    loop {
        let out = render(&head, &lists, &tail);
        if out.len() <= MAP_SIZE {
            return out;
        }
        let Some(i) = [2, 0, 1].into_iter().find(|&i| lists[i].1.len() > 1) else { return out };
        lists[i].1.pop();
        lists[i].2 += 1;
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Section {
    Do,
    Dont,
    Other,
}

impl Section {
    fn of(heading: &str) -> Section {
        let h = heading.trim_end_matches(':').to_lowercase().replace('’', "'");
        let h = h.trim_start_matches(|c: char| c.is_ascii_digit() || c == '.' || c == ' ');
        match h {
            "do" | "do's" | "dos" => Section::Do,
            "don't" | "don'ts" | "do not" | "donts" => Section::Dont,
            _ => Section::Other,
        }
    }
}

fn render(head: &[String], lists: &[(&str, Vec<String>, usize)], tail: &[String]) -> String {
    let mut lines: Vec<String> = head.to_vec();
    for (label, items, dropped) in lists {
        if items.is_empty() {
            continue;
        }
        lines.push(label.to_string());
        lines.extend(items.iter().map(|i| format!("- {i}")));
        if *dropped > 0 {
            lines.push(format!("- (+{dropped} more in the full file)"));
        }
    }
    lines.extend(tail.iter().cloned());
    lines.join("\n")
}

fn capped_line(label: &str, entries: &[String], budget: usize, rest: &str) -> String {
    let mut line = label.to_string();
    for (i, entry) in entries.iter().enumerate() {
        let sep = if i == 0 { "" } else { ", " };
        if i > 0 && line.len() + sep.len() + entry.len() > budget {
            return format!("{line} (+{} more {rest})", entries.len() - i);
        }
        line.push_str(sep);
        line.push_str(entry);
    }
    line
}

/// The lines after the frontmatter.
fn body_lines(design: &str) -> Vec<&str> {
    let lines: Vec<&str> = design.lines().collect();
    if lines.first().map(|l| l.trim()) == Some("---") {
        if let Some(end) = lines.iter().skip(1).position(|l| l.trim() == "---") {
            return lines[end + 2..].to_vec();
        }
    }
    lines
}

fn north_star(line: &str) -> Option<String> {
    let idx = line.find("North Star:")?;
    let rest = line[idx + "North Star:".len()..].trim().trim_end_matches("**").trim();
    (!rest.is_empty()).then(|| rest.to_string())
}

/// `**The X Rule.** First sentence.` -> `The X Rule. First sentence.`
fn named_rule(line: &str) -> Option<String> {
    let inner = line.strip_prefix("**")?;
    let end = inner.find("**")?;
    let lead = inner[..end].trim().trim_end_matches('.');
    if !lead.ends_with("Rule") && !lead.ends_with("rule") {
        return None;
    }
    let sentence = first_sentence(inner[end + 2..].trim().replace("**", "").as_str());
    Some(if sentence.is_empty() { format!("{lead}.") } else { format!("{lead}. {sentence}") })
}

/// Text up to the first `.`, `!` or `?` followed by whitespace or the end, outside backticks and brackets.
fn first_sentence(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let (mut code, mut depth) = (false, 0i32);
    for (i, &c) in chars.iter().enumerate() {
        match c {
            '`' => code = !code,
            '(' | '[' if !code => depth += 1,
            ')' | ']' if !code => depth -= 1,
            '.' | '!' | '?' if !code && depth <= 0 => {
                if chars.get(i + 1).is_none_or(|n| n.is_whitespace()) {
                    return chars[..=i].iter().collect();
                }
            }
            _ => {}
        }
    }
    text.to_string()
}

/// Backticked spans and markdown link targets that look like file paths.
fn path_mentions(line: &str) -> Vec<String> {
    let mut found = Vec::new();
    for (i, span) in line.split('`').enumerate() {
        if i % 2 == 1 {
            found.push(span.to_string());
        }
    }
    let mut rest = line;
    while let Some(at) = rest.find("](") {
        rest = &rest[at + 2..];
        if let Some(end) = rest.find(')') {
            found.push(rest[..end].to_string());
            rest = &rest[end..];
        }
    }
    found.retain(|p| !p.is_empty() && !p.contains(char::is_whitespace) && !p.contains("://") && (p.contains('/') || p.contains('.')));
    found
}

fn is_relative_path(p: &str) -> bool {
    let path = Path::new(p);
    !path.is_absolute() && !p.starts_with('~') && path.components().all(|c| matches!(c, std::path::Component::Normal(_)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn landing_demo_keeps_its_guardrails_in_budget() {
        let design = include_str!("../../../demos/landing-demo/DESIGN.md");
        let out = map(design, Path::new("/nonexistent"), "DESIGN.md");
        assert!(out.len() <= MAP_SIZE, "{} bytes:\n{out}", out.len());
        // The spacing and radius scales: off-scale values were the gate's one regression.
        assert!(out.contains("Spacing: xs 8px, sm 16px, md 24px") && out.contains("Radius: card 20px"), "{out}");
        for kept in [
            "The 10% Accent Rule. The burnt orange covers no more than 10% of any rendered surface.",
            "Don't add box-shadows to surfaces.",
            "Fraunces (",
            "Inter (",
            "accent #c8552b",
            "North Star: \"Editorial confidence in warm light.\"",
            "Full: DESIGN.md (read a section when you need its detail)",
        ] {
            assert!(out.contains(kept), "missing {kept:?}:\n{out}");
        }
    }

    #[test]
    fn names_only_mentioned_files_that_exist_under_the_root() {
        let root = std::env::temp_dir().join(format!("impeccable-design-map-{}", std::process::id()));
        std::fs::create_dir_all(root.join("src/styles")).unwrap();
        std::fs::write(root.join("src/styles/tokens.css"), "").unwrap();
        let design = "# D\n\nTokens live in `src/styles/tokens.css`; see [the kit](src/kit.css), `../secret.css` and `/etc/hosts`.\n";
        let out = map(design, &root, "DESIGN.md");
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(out, "Map: src/styles/tokens.css\nFull: DESIGN.md (read a section when you need its detail)");
    }
}
