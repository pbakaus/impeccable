//! `impeccable design-lookup <term>…`: one token, component or DESIGN.md section on demand (REN-2129, S4).
//!
//! `context` carries DESIGN.md as a map; this answers what the map leaves out without reading a whole file. It looks in
//! DESIGN.md's frontmatter, its sidecar (colour roles, shadows, motion, radii, type roles and components), the custom
//! properties of the token files DESIGN.md names, and its sections (in `.impeccable/design-full.md` once compacted), and
//! prints only what matches, each with where it lives.

use crate::context::load_context;
use crate::design_compact::ARCHIVE;
use crate::design_map::{path_mentions, is_relative_path, MAP_MARKER};
use crate::design_parser::parse_design_md;
use crate::jsp;
use crate::target_args::parse_target_options;
use crate::util::safe_read;
use impeccable_common::Io;
use serde_json::Value;
use std::path::Path;

const SIDECAR: &str = ".impeccable/design.json";
/// The most a lookup prints (about 600 tokens): a few entries and one section, never a file.
const OUT_SIZE: usize = 2400;
/// The most one entry or one section may take.
const ENTRY_SIZE: usize = 600;
const SECTION_SIZE: usize = 1400;

fn usage() -> &'static str {
    "Usage: impeccable design-lookup <term>... [--target <path>]\n\n\
Print the design tokens, components and DESIGN.md sections whose name or value\n\
contains a term (case-insensitive), each with the file it lives in: DESIGN.md's\n\
frontmatter, .impeccable/design.json, the token files DESIGN.md names, and its\n\
sections. Use it for a detail the DESIGN.md map in `context` leaves out instead\n\
of reading a whole file.\n\n\
  --target <path>  Select a workspace in a monorepo."
}

/// One thing a term can find: what it is called, its value or summary, and where it lives.
struct Entry {
    name: String,
    text: String,
    at: String,
}

fn clip(s: &str, max: usize) -> String {
    let flat = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.len() <= max {
        return flat;
    }
    let mut cut = max.saturating_sub(1);
    while !flat.is_char_boundary(cut) {
        cut -= 1;
    }
    format!("{}…", &flat[..cut])
}

/// Every scalar of the frontmatter, by its key path (`colors.brand`, `typography.body.fontFamily`).
fn frontmatter_entries(design: &str, rel: &str, out: &mut Vec<Entry>) {
    fn walk(prefix: &str, v: &Value, at: &str, out: &mut Vec<Entry>) {
        match v {
            Value::Object(m) => m.iter().for_each(|(k, v)| walk(&if prefix.is_empty() { k.clone() } else { format!("{prefix}.{k}") }, v, at, out)),
            Value::Array(a) => a.iter().enumerate().for_each(|(i, v)| walk(&format!("{prefix}.{i}"), v, at, out)),
            Value::String(s) => out.push(Entry { name: prefix.to_string(), text: s.clone(), at: at.to_string() }),
            Value::Null => {}
            other => out.push(Entry { name: prefix.to_string(), text: other.to_string(), at: at.to_string() }),
        }
    }
    if let Some(fm) = parse_design_md(design).frontmatter {
        walk("", &Value::Object(fm), &format!("{rel} frontmatter"), out);
    }
}

/// The sidecar's named entries: colour roles, the vocabularies `document` records, and components with their CSS.
fn sidecar_entries(sidecar: &Value, at: &str, out: &mut Vec<Entry>) {
    let s = |v: &Value, k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    // A value, then its description: a full stop between them unless one is already there.
    let join = |parts: &[String]| {
        parts.iter().filter(|p| !p.is_empty()).fold(String::new(), |acc, p| {
            if acc.is_empty() { p.clone() } else if acc.ends_with('.') { format!("{acc} {p}") } else { format!("{acc}. {p}") }
        })
    };
    if let Some(meta) = sidecar.pointer("/extensions/colorMeta").and_then(Value::as_object) {
        for (key, m) in meta {
            let role = s(m, "role");
            out.push(Entry {
                name: format!("{} ({key}{})", s(m, "displayName"), if role.is_empty() { String::new() } else { format!(", {role}") }),
                text: join(&[s(m, "canonical"), s(m, "description")]),
                at: at.to_string(),
            });
        }
    }
    for (group, kind) in [("shadows", "shadow"), ("motion", "motion"), ("breakpoints", "breakpoint")] {
        for item in sidecar.pointer(&format!("/extensions/{group}")).and_then(Value::as_array).into_iter().flatten() {
            out.push(Entry { name: format!("{} ({kind})", s(item, "name")), text: join(&[s(item, "value"), s(item, "purpose")]), at: at.to_string() });
        }
    }
    for (group, kind) in [("roundedMeta", "radius"), ("typographyMeta", "type")] {
        for (key, m) in sidecar.pointer(&format!("/extensions/{group}")).and_then(Value::as_object).into_iter().flatten() {
            let name = s(m, "displayName");
            out.push(Entry {
                name: format!("{} ({kind})", if name.is_empty() { key.clone() } else { format!("{name}, {key}") }),
                text: join(&[s(m, "value"), s(m, "purpose")]),
                at: at.to_string(),
            });
        }
    }
    for c in sidecar.get("components").and_then(Value::as_array).into_iter().flatten() {
        out.push(Entry {
            name: format!("{} (component{})", s(c, "name"), if s(c, "refersTo").is_empty() { String::new() } else { format!(", {}", s(c, "refersTo")) }),
            text: join(&[s(c, "description"), s(c, "css")]),
            at: at.to_string(),
        });
    }
}

/// Each custom property a token file declares (`--name: value;`, a value over several lines joined), with its line.
fn custom_properties(css: &str, rel: &str, out: &mut Vec<Entry>) {
    let lines: Vec<&str> = css.lines().collect();
    for (i, line) in lines.iter().enumerate() {
        let t = line.trim_start();
        let Some(rest) = t.strip_prefix("--") else { continue };
        let Some(colon) = rest.find(':') else { continue };
        let name = &rest[..colon];
        if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            continue;
        }
        let mut value = rest[colon + 1..].to_string();
        let mut j = i;
        while !value.contains(';') && !value.contains('}') && j + 1 < lines.len() && j < i + 12 {
            j += 1;
            value.push(' ');
            value.push_str(lines[j].trim());
        }
        let value = value.split([';', '}']).next().unwrap_or("").trim().to_string();
        out.push(Entry { name: format!("--{name}"), text: value, at: format!("{rel}:{}", i + 1) });
    }
}

/// The `#`-headed sections of `doc` whose heading contains `term`, each whole up to `SECTION_SIZE`, with its line.
fn sections(doc: &str, rel: &str, term: &str) -> Vec<String> {
    let lines: Vec<&str> = doc.lines().collect();
    let level = |l: &str| if l.starts_with('#') { l.chars().take_while(|&c| c == '#').count() } else { 0 };
    let mut found = Vec::new();
    let mut fence = false;
    for (i, line) in lines.iter().enumerate() {
        if line.trim_start().starts_with("```") {
            fence = !fence;
        }
        let depth = level(line);
        if fence || depth == 0 || !line[depth..].starts_with(' ') || !line.to_lowercase().contains(term) {
            continue;
        }
        let end = (i + 1..lines.len()).find(|&j| (1..=depth).contains(&level(lines[j])) && lines[j][level(lines[j])..].starts_with(' ')).unwrap_or(lines.len());
        let mut body = lines[i..end].join("\n").trim_end().to_string();
        if body.len() > SECTION_SIZE {
            let mut cut = SECTION_SIZE;
            while !body.is_char_boundary(cut) {
                cut -= 1;
            }
            body.truncate(cut);
            body.push_str(&format!("\n… (continues in {rel} from line {})", i + 1));
        }
        found.push(format!("{body}\n({rel}:{})", i + 1));
    }
    found
}

/// What `terms` find in the design system DESIGN.md (`design`, at `rel` in `dir`) describes, within `OUT_SIZE`.
pub fn lookup(design: &str, rel: &str, dir: &Path, terms: &[String]) -> String {
    let mut entries = Vec::new();
    frontmatter_entries(design, rel, &mut entries);
    if let Some(sidecar) = safe_read(&dir.join(SIDECAR).to_string_lossy()).and_then(|t| serde_json::from_str::<Value>(&t).ok()) {
        sidecar_entries(&sidecar, SIDECAR, &mut entries);
    }
    // Once compacted, the sections (and the files they name) are in the archive.
    let archived = design.contains(MAP_MARKER).then(|| safe_read(&dir.join(ARCHIVE).to_string_lossy())).flatten();
    let (doc, doc_rel) = match &archived {
        Some(full) => (full.as_str(), ARCHIVE),
        None => (design, rel),
    };
    let mut files: Vec<String> = [design, doc].iter().flat_map(|d| d.lines().flat_map(path_mentions)).collect();
    files.retain(|p| is_relative_path(p) && crate::staleness_deep::is_token_file(p));
    files.sort();
    files.dedup();
    for f in &files {
        if let Some(css) = safe_read(&dir.join(f).to_string_lossy()) {
            custom_properties(&css, f, &mut entries);
        }
    }

    let terms: Vec<String> = terms.iter().map(|t| t.to_lowercase()).filter(|t| !t.is_empty()).collect();
    // Names that match come before values and descriptions that do.
    let mut hits: Vec<(usize, &Entry)> = entries
        .iter()
        .filter_map(|e| {
            let (name, text) = (e.name.to_lowercase(), e.text.to_lowercase());
            terms.iter().filter_map(|t| if name.contains(t.as_str()) { Some(0) } else if text.contains(t.as_str()) { Some(1) } else { None }).min().map(|rank| (rank, e))
        })
        .collect();
    hits.sort_by_key(|(rank, _)| *rank);
    let mut found_sections: Vec<String> = terms.iter().flat_map(|t| sections(doc, doc_rel, t)).collect();
    found_sections.dedup();

    let mut out = String::new();
    let mut left = 0;
    for (_, e) in &hits {
        let line = format!("{}: {} ({})\n", e.name, clip(&e.text, ENTRY_SIZE), e.at);
        if out.len() + line.len() > OUT_SIZE {
            left += 1;
            continue;
        }
        out.push_str(&line);
    }
    for s in &found_sections {
        if out.len() + s.len() + 2 > OUT_SIZE {
            left += 1;
            continue;
        }
        out.push('\n');
        out.push_str(s);
        out.push('\n');
    }
    if left > 0 {
        out.push_str(&format!("\n{left} more match{}; use a narrower term.\n", if left == 1 { "" } else { "es" }));
    }
    if out.is_empty() {
        let mut looked = vec![format!("{rel} (frontmatter and sections)"), SIDECAR.to_string()];
        if archived.is_some() {
            looked.push(ARCHIVE.to_string());
        }
        let (here, gone): (Vec<String>, Vec<String>) = files.into_iter().partition(|f| dir.join(f).is_file());
        looked.extend(here);
        out = format!("Nothing matches {} in {}.\n", terms.join(", "), looked.join(", "));
        if !gone.is_empty() {
            out.push_str(&format!("DESIGN.md names token files that are not there: {}.\n", gone.join(", ")));
        }
    }
    out
}

pub fn run(args: &[String], io: &mut Io) -> i32 {
    let (mut terms, mut passthrough) = (Vec::new(), Vec::new());
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--help" | "-h" => {
                io.out(&format!("{}\n", usage()));
                return 0;
            }
            "--target" => {
                passthrough.push(a.clone());
                passthrough.extend(it.next().cloned());
            }
            _ if a.starts_with("--") => passthrough.push(a.clone()),
            _ => terms.push(a.clone()),
        }
    }
    if terms.is_empty() {
        io.err(&format!("{}\n", usage()));
        return 1;
    }
    let target = match parse_target_options(&passthrough, true) {
        Ok(t) => t,
        Err(msg) => {
            io.err(&format!("{msg}\n"));
            return 1;
        }
    };
    let cwd = io.cwd.to_string_lossy().into_owned();
    let env = io.env.clone();
    let ctx = load_context(&cwd, &target, &env);
    let Some(rel) = ctx.design_path.clone() else {
        io.out("No DESIGN.md here. `/impeccable document` writes one from the code.\n");
        return 0;
    };
    let path = jsp::resolve(&cwd, &[&rel]);
    let Some(design) = safe_read(&path) else {
        io.err(&format!("Could not read {rel}.\n"));
        return 1;
    };
    let dir = Path::new(&path).parent().map(Path::to_path_buf).unwrap_or_default();
    io.out(&lookup(&design, &rel, &dir, &terms));
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh directory holding `files`, unique per test and process.
    fn dir_with(name: &str, files: &[(&str, &str)]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("impeccable-lookup-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for (p, body) in files {
            let path = dir.join(p);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, body).unwrap();
        }
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    const DESIGN: &str = "---\nname: Demo\ncolors:\n  brand: \"#c8552b\"\n  ink: \"#111\"\n---\n\n# Demo\n\nTokens live in `src/tokens.css`.\n\n## Elevation\n\nCards rest on borders. Lift is for hover only.\n\n```css\n# not a heading\n```\n\n## Typography\n\nOne family.\n";

    #[test]
    fn finds_a_custom_property_with_its_line_and_a_frontmatter_colour_by_value() {
        let dir = dir_with("prop", &[("src/tokens.css", ":root {\n  --brand: #c8552b;\n  --cap-lift:\n    inset 0 1px 0 white,\n    0 2px 3px black;\n}\n")]);
        let out = lookup(DESIGN, "DESIGN.md", &dir, &["cap-lift".into()]);
        assert_eq!(out, "--cap-lift: inset 0 1px 0 white, 0 2px 3px black (src/tokens.css:3)\n");
        let out = lookup(DESIGN, "DESIGN.md", &dir, &["#C8552B".into()]);
        assert!(out.starts_with("colors.brand: #c8552b (DESIGN.md frontmatter)\n--brand: #c8552b (src/tokens.css:2)\n"), "{out}");
    }

    #[test]
    fn a_heading_brings_its_whole_section_and_a_fenced_hash_is_not_a_heading() {
        let dir = dir_with("section", &[]);
        let out = lookup(DESIGN, "DESIGN.md", &dir, &["elevation".into()]);
        assert!(out.contains("## Elevation\n\nCards rest on borders. Lift is for hover only.") && out.contains("(DESIGN.md:12)"), "{out}");
        assert!(!out.contains("One family"), "{out}");
        assert!(lookup(DESIGN, "DESIGN.md", &dir, &["not a heading".into()]).starts_with("Nothing matches"));
    }

    #[test]
    fn reads_the_sidecar_and_a_compacted_file_s_archive() {
        let sidecar = r#"{"extensions":{"shadows":[{"name":"CTA Lift","value":"0 18px 48px black","purpose":"Hover lift."}]},"components":[{"name":"Primary Button","refersTo":"button-primary","description":"Filled CTA.","css":".btn { color: gold; }"}]}"#;
        let compacted = format!("---\nname: Demo\n---\n\n# Demo\n\n{MAP_MARKER}\nFull: {ARCHIVE}\n");
        let dir = dir_with("sidecar", &[(SIDECAR, sidecar), (ARCHIVE, DESIGN), ("src/tokens.css", "--brand: #c8552b;\n")]);
        let out = lookup(&compacted, "DESIGN.md", &dir, &["lift".into(), "button".into(), "elevation".into()]);
        assert!(out.contains("CTA Lift (shadow): 0 18px 48px black. Hover lift. (.impeccable/design.json)"), "{out}");
        assert!(out.contains("Primary Button (component, button-primary): Filled CTA. .btn { color: gold; } (.impeccable/design.json)"), "{out}");
        // The archive's section, and the token file only the archive names.
        assert!(out.contains(&format!("({ARCHIVE}:12)")), "{out}");
        assert!(lookup(&compacted, "DESIGN.md", &dir, &["--brand".into()]).contains("(src/tokens.css:1)"));
    }

    #[test]
    fn output_is_bounded_and_says_how_much_it_left() {
        let css: String = (0..200).map(|i| format!("--gold-{i}: oklch({i}% 0.1 80);\n")).collect();
        let dir = dir_with("bounded", &[("src/tokens.css", &css)]);
        let out = lookup(DESIGN, "DESIGN.md", &dir, &["gold".into()]);
        assert!(out.len() <= OUT_SIZE + 60, "{}", out.len());
        assert!(out.trim_end().ends_with("more matches; use a narrower term."), "{out}");
    }
}
