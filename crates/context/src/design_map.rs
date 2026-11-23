//! A compact map of a long DESIGN.md, built by fixed code, that `context`
//! carries in place of the full file: its tokens (colours by role when the
//! sidecar names them), North Star, named rules, elevation vocabulary, Do and
//! Don't leads, the files it points at, and where the full file is.

use crate::design_parser::parse_design_md;
use serde_json::Value;
use std::path::Path;

/// Bytes a document may take in `context` before it is carried as a map.
pub const MAP_BUDGET: usize = 1600;
/// Bytes the map itself may take (about 600 tokens): room for every rule of a large system, which the
/// guardrails need more than the long tail of its palette (REN-2129 gate, 17 Nov).
pub const MAP_SIZE: usize = 2400;
/// Marks a DESIGN.md that `design-compact` wrote as its map: `context` carries its body as written, never a map of a map.
pub const MAP_MARKER: &str = "<!-- impeccable:design-map -->";
const COLOR_LINE_BUDGET: usize = 240;
/// The colour-role line is shorter: one colour per role says more than the long tail of a ramp.
const ROLE_LINE_BUDGET: usize = 200;
/// The sidecar `document` writes beside DESIGN.md; its `extensions.colorMeta` names each colour's role.
const SIDECAR: &str = ".impeccable/design.json";
/// Colour roles in the order the map lists them; any other role follows in the sidecar's order.
const ROLE_ORDER: [&str; 8] = ["primary", "interaction", "secondary", "tertiary", "surface", "neutral", "accent", "state"];
const SCALE_LINE_BUDGET: usize = 200;
/// The longest any one line of the map may be.
const LINE_MAX: usize = 280;
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
    let colors = fm.get("colors").and_then(Value::as_object);
    if let Some(line) = role_colors(root, colors) {
        head.push(line);
    } else if let Some(colors) = colors {
        let entries: Vec<String> = colors.iter().filter_map(|(k, v)| v.as_str().map(|v| format!("{k} {v}"))).collect();
        if !entries.is_empty() {
            head.push(capped_line("Colors: ", &entries, ", ", COLOR_LINE_BUDGET, "in the frontmatter"));
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
                head.push(capped_line(label, &entries, ", ", SCALE_LINE_BUDGET, "in the frontmatter"));
            }
        }
    }

    let body = body_lines(design);
    let mut rules = Vec::new();
    let mut elevation = Vec::new();
    // Whether each elevation item gives a value: those are the vocabulary an agent can't infer, so they outlast the rules.
    let mut valued: Vec<bool> = Vec::new();
    let mut dos = Vec::new();
    let mut donts = Vec::new();
    let mut paths: Vec<String> = Vec::new();
    let mut section = Section::Other;
    // The heading level of the shadow, elevation or depth section the line is in, if any.
    let mut depth_level: Option<usize> = None;
    for line in &body {
        let t = line.trim();
        if t.starts_with('#') {
            let heading = t.trim_start_matches('#').trim();
            section = Section::of(heading);
            let level = t.len() - t.trim_start_matches('#').len();
            let lower = heading.to_lowercase();
            if ["shadow", "elevation", "depth"].iter().any(|w| lower.contains(w)) {
                depth_level = Some(depth_level.map_or(level, |l| l.min(level)));
            } else if depth_level.is_some_and(|l| level <= l) {
                depth_level = None;
            }
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
                Section::Other if depth_level.is_some() && item.starts_with("**") => {
                    let (entry, has_value) = elevation_item(item, lead);
                    elevation.push(entry);
                    valued.push(has_value);
                }
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
    // Over the cap, the Do bullets give way first, to none (they restate the rules, and the `Full:` line covers them); then the elevation items that
    // give no value, the rules, the elevation values, and the Don'ts last. The last three keep at least their first
    // item, and each list names what it dropped.
    let mut lists = [("Rules:", rules, 0usize), ("Elevation:", elevation, 0), ("Don't:", donts, 0), ("Do:", dos, 0)];
    loop {
        let out = render(&head, &lists, &tail);
        if out.len() <= MAP_SIZE {
            return out;
        }
        let prose = valued.iter().rposition(|v| !v).filter(|_| lists[1].1.len() > 1);
        let (i, at) = if !lists[3].1.is_empty() {
            (3, lists[3].1.len() - 1)
        } else if let Some(at) = prose {
            (1, at)
        } else if let Some(i) = [0, 1, 2].into_iter().find(|&i| lists[i].1.len() > 1) {
            (i, lists[i].1.len() - 1)
        } else {
            return capped(&out, &tail);
        };
        lists[i].1.remove(at);
        lists[i].2 += 1;
        if i == 1 {
            valued.remove(at);
        }
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

/// The map within `MAP_SIZE` whatever its entries: whole lines up to the cap, then the `Full:` pointer, so long
/// single entries (a first rule, a font list) can never push what follows `context` past an output limit.
fn capped(out: &str, tail: &[String]) -> String {
    let pointer = tail.last().cloned().unwrap_or_default();
    let mut kept = String::new();
    for line in out.lines() {
        if *line == *pointer {
            break;
        }
        if kept.len() + line.len() + pointer.len() + 2 > MAP_SIZE {
            break;
        }
        kept.push_str(line);
        kept.push('\n');
    }
    format!("{kept}{pointer}")
}

/// One line as the map carries it: at most `LINE_MAX` bytes, cut at a character boundary with an ellipsis.
fn short(line: String) -> String {
    if line.len() <= LINE_MAX {
        return line;
    }
    let mut cut = LINE_MAX - 3;
    while !line.is_char_boundary(cut) {
        cut -= 1;
    }
    format!("{}...", &line[..cut])
}

fn render(head: &[String], lists: &[(&str, Vec<String>, usize)], tail: &[String]) -> String {
    let mut lines: Vec<String> = head.iter().cloned().map(short).collect();
    for (label, items, dropped) in lists {
        if items.is_empty() {
            continue;
        }
        lines.push(label.to_string());
        lines.extend(items.iter().map(|i| short(format!("- {i}"))));
        if *dropped > 0 {
            lines.push(format!("- (+{dropped} more)"));
        }
    }
    lines.extend(tail.iter().cloned());
    lines.join("\n")
}

/// `Colors:` by the roles the sidecar's `colorMeta` gives them: the first colour of each role (primary first),
/// then the rest, each with its frontmatter value (else the sidecar's canonical one); `None` without a sidecar
/// that names a role.
fn role_colors(root: &Path, colors: Option<&serde_json::Map<String, Value>>) -> Option<String> {
    let sidecar: Value = serde_json::from_str(&std::fs::read_to_string(root.join(SIDECAR)).ok()?).ok()?;
    let meta = sidecar.pointer("/extensions/colorMeta")?.as_object()?;
    let mut entries: Vec<(bool, usize, String)> = Vec::new();
    let mut seen: Vec<&str> = Vec::new();
    for (name, m) in meta {
        let Some(role) = m.get("role").and_then(Value::as_str).filter(|r| !r.is_empty()) else { continue };
        let Some(value) = colors.and_then(|c| c.get(name)).or_else(|| m.get("canonical")).and_then(Value::as_str) else { continue };
        let rank = ROLE_ORDER.iter().position(|r| r.eq_ignore_ascii_case(role)).unwrap_or(ROLE_ORDER.len());
        entries.push((seen.contains(&role), rank, format!("{role}: {name} {value}")));
        seen.push(role);
    }
    entries.sort_by_key(|(repeat, rank, _)| (*repeat, *rank));
    let entries: Vec<String> = entries.into_iter().map(|(_, _, e)| e).collect();
    (!entries.is_empty()).then(|| capped_line("Colors: ", &entries, "; ", ROLE_LINE_BUDGET, "in the sidecar"))
}

fn capped_line(label: &str, entries: &[String], separator: &str, budget: usize, rest: &str) -> String {
    let mut line = label.to_string();
    for (i, entry) in entries.iter().enumerate() {
        let sep = if i == 0 { "" } else { separator };
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

/// A bold-led item of the shadow vocabulary: `Name: value` when a backticked value follows its name, else its first
/// sentence; and whether it gave a value.
fn elevation_item(item: &str, lead: String) -> (String, bool) {
    let mut parts = item.trim_start_matches("**").splitn(2, "**");
    let (name, rest) = (parts.next().unwrap_or("").trim().trim_end_matches(':'), parts.next().unwrap_or(""));
    // `**Name:** `value`` as written, or `**Name** (`box-shadow: value`)` as the `document` template writes it.
    let rest = rest.trim_start_matches(':').trim_start();
    let value = rest.trim_start_matches('(').strip_prefix('`').and_then(|v| v.split('`').next());
    let value = value.map(|v| v.strip_prefix("box-shadow:").unwrap_or(v).trim());
    match value.filter(|v| !v.trim().is_empty() && !name.is_empty()) {
        Some(value) => (format!("{name}: {value}"), true),
        None => (lead.replace('`', ""), false),
    }
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
pub(crate) fn path_mentions(line: &str) -> Vec<String> {
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

pub(crate) fn is_relative_path(p: &str) -> bool {
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
    fn a_map_of_huge_entries_stays_within_its_cap() {
        // Catches single long entries (a rule, a font list) pushing the map, and so `context`, past its cap.
        let long = "x".repeat(5000);
        let design = format!("---\nname: Big\n---\n\n**North Star: {long}**\n\n**The Only Rule.** {long}.\n\n## Don't\n\n- Don't {long}.\n\n## Do\n\n- Do {long}.\n");
        let out = map(&design, Path::new("."), "DESIGN.md");
        assert!(out.len() <= MAP_SIZE, "{}", out.len());
        assert!(out.ends_with("Full: DESIGN.md (read a section when you need its detail)"), "{out}");
    }

    #[test]
    fn this_repo_carries_its_colour_roles_and_shadow_values_with_every_guardrail() {
        // Catches the gate's gold-glow break: the CTA's shadow value and the colour roles must arrive inline,
        // without costing a Don't.
        let root = Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
        let out = map(include_str!("../../../DESIGN.md"), root, "DESIGN.md");
        assert!(out.len() <= MAP_SIZE, "{} bytes:\n{out}", out.len());
        // The hover gold arrives beside the gold itself (interaction ranks right after primary), and patina-deep, the
        // one colour that may carry text on paper, before the surfaces.
        assert!(out.contains("Colors: primary: kinpaku oklch(84% 0.19 80.46); interaction: kinpaku-vivid oklch(87% 0.20 85); secondary: patina-deep oklch(46% 0.08 188)"), "{out}");
        // The controls' raised cap by its token and value (the gate's missing CTA Lift was this).
        assert!(out.contains("- --ks-cap-lift: inset 0 1px 0 oklch(100% 0 0 / 0.9), 0 1px 0 oklch(13% 0 0 / 0.14), 0 2px 3px oklch(13% 0 0 / 0.08)\n"), "{out}");
        // Every Don't: they give way last.
        let donts = out.split("Don't:\n").nth(1).unwrap().lines().take_while(|l| l.starts_with("- "));
        assert!(!donts.into_iter().any(|l| l.starts_with("- (+")), "{out}");
    }

    #[test]
    fn colour_roles_come_from_the_sidecar_primary_first() {
        let root = std::env::temp_dir().join(format!("impeccable-design-map-roles-{}", std::process::id()));
        std::fs::create_dir_all(root.join(".impeccable")).unwrap();
        let sidecar = r##"{"extensions":{"colorMeta":{
            "paper":{"role":"neutral","canonical":"oklch(97% 0 0)"},
            "ink":{"role":"neutral","canonical":"oklch(15% 0 0)"},
            "warn":{"role":"state","canonical":"oklch(60% 0.2 30)"},
            "brand":{"role":"primary","canonical":"oklch(60% 0.2 40)"}}}}"##;
        std::fs::write(root.join(".impeccable/design.json"), sidecar).unwrap();
        let design = "---\ncolors:\n  aaa: \"#000001\"\n  brand: \"#c8552b\"\n---\n";
        let out = map(design, &root, "DESIGN.md");
        let _ = std::fs::remove_dir_all(&root);
        // One colour per role first, so a long neutral ramp can't crowd out the state colours; frontmatter values win.
        assert!(out.starts_with("Colors: primary: brand #c8552b; neutral: paper oklch(97% 0 0); state: warn oklch(60% 0.2 30); neutral: ink oklch(15% 0 0)\n"), "{out}");
        // Without a sidecar, the frontmatter's colours in order.
        assert!(map(design, Path::new("/nonexistent"), "DESIGN.md").starts_with("Colors: aaa #000001, brand #c8552b\n"));
    }

    #[test]
    fn elevation_carries_the_shadow_sections_bold_items_and_gives_way_in_order() {
        let design = "## Elevation and Material\n\n### Shadow Vocabulary\n\n- **Lift:** `0 8px 24px oklch(0% 0 0 / 0.3)` for CTAs only.\n- **Halo** (`box-shadow: 0 0 0 1px gold`): rings.\n- **No Card Shadow:** Cards rest on borders. More.\n- plain bullet\n\n### Material Rules\n\n- **Grain:** kept, still under Elevation.\n\n## Components\n\n- **Button:** `0 1px 0 red`\n";
        let out = map(design, Path::new("/nonexistent"), "DESIGN.md");
        assert!(out.starts_with("Elevation:\n- Lift: 0 8px 24px oklch(0% 0 0 / 0.3)\n- Halo: 0 0 0 1px gold\n- No Card Shadow: Cards rest on borders.\n- Grain: kept, still under Elevation.\nFull:"), "{out}");
        // Over the cap: Do goes first (to none), then elevation prose, then rules, then elevation values.
        let dos: String = (0..4).map(|i| format!("- Do d{i}.\n")).collect();
        let (mut prose_before_rules, mut rules_before_values) = (false, false);
        for n in 1..80 {
            let rules: String = (0..n).map(|i| format!("**The R{i} Rule.** {}.\n\n", "r".repeat(20))).collect();
            let out = map(&format!("{rules}{design}\n## Do\n\n{dos}"), Path::new("/nonexistent"), "DESIGN.md");
            assert!(out.len() <= MAP_SIZE, "{}", out.len());
            let all_rules = out.contains(&format!("- The R{} Rule.", n - 1));
            let all_prose = out.contains("- No Card Shadow:") && out.contains("- Grain:");
            let any_prose = out.contains("- No Card Shadow:") || out.contains("- Grain:");
            let has_do = out.contains("- Do d");
            assert!(all_prose || !has_do, "n={n}: {out}");
            assert!(all_rules || (!has_do && !any_prose), "n={n}: {out}");
            assert!(out.contains("- Halo:") || !out.contains("- The R1 Rule."), "n={n}: {out}");
            prose_before_rules |= all_rules && !any_prose;
            rules_before_values |= !all_rules && out.contains("- Halo:");
        }
        assert!(prose_before_rules && rules_before_values);
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
