//! `impeccable design-compact`: a long DESIGN.md proposed as its short map (REN-2129, S3).
//!
//! It proposes; it never writes on its own. Without `--write` it prints the compact DESIGN.md it would write and what
//! it saves. With `--write`, which an agent passes only after the person agrees, the whole original moves to
//! `.impeccable/design-full.md` (never over an existing one) and DESIGN.md becomes the map: the frontmatter verbatim,
//! which the detector reads, then the map `context` already carries, pointing at the original for any section's detail.

use crate::context::load_context;
use crate::design_map::{self, MAP_BUDGET};
use crate::jsp;
use crate::target_args::parse_target_options;
use crate::util::safe_read;
use impeccable_common::Io;

/// Where the original goes, relative to DESIGN.md's directory.
pub const ARCHIVE: &str = ".impeccable/design-full.md";

fn usage() -> &'static str {
    "Usage: impeccable design-compact [--write] [--target <path>]\n\n\
Propose DESIGN.md as its short map: the frontmatter as it is, then the guardrails,\n\
scales and the files it names. Prints the proposal and what it saves; writes\n\
nothing.\n\n\
  --write          Write it: the original moves to .impeccable/design-full.md\n\
                   (never over an existing one), and DESIGN.md becomes the map.\n\
                   Pass it only after the person has agreed to the proposal.\n\
  --target <path>  Select a workspace in a monorepo."
}

/// The frontmatter block as written (`---` to `---`, with its newline), and the rest.
fn split_frontmatter(design: &str) -> (&str, &str) {
    if let Some(rest) = design.strip_prefix("---\n").or_else(|| design.strip_prefix("---\r\n")) {
        if let Some(end) = rest.find("\n---") {
            let close = end + "\n---".len();
            let after = rest[close..].find('\n').map_or(rest.len(), |n| close + n + 1);
            let cut = design.len() - rest.len() + after;
            return (&design[..cut], &design[cut..]);
        }
    }
    ("", design)
}

/// The frontmatter without its YAML comments: whole-line ones, and a trailing ` # …` after a plain `key: value` (a
/// quoted value keeps any `#` inside its quotes; block-scalar text is never cut). The keys and values the detector and
/// the map read are untouched; what the comments explained stays in the original.
fn without_comments(frontmatter: &str) -> String {
    static KEY_VALUE: once_cell::sync::Lazy<regex::Regex> = once_cell::sync::Lazy::new(|| {
        regex::Regex::new(r#"^(\s*[A-Za-z0-9_-]+:\s*(?:"[^"]*"|'[^']*'|[^"'#\s][^"'#]*?)?)\s+#.*$"#).unwrap()
    });
    let mut out = String::with_capacity(frontmatter.len());
    for line in frontmatter.split_inclusive('\n') {
        let bare = line.trim_end_matches(['\n', '\r']);
        if bare.trim_start().starts_with('#') {
            continue;
        }
        let kept = KEY_VALUE.captures(bare).map_or(bare, |c| c.get(1).map_or(bare, |m| m.as_str()));
        out.push_str(kept.trim_end());
        out.push('\n');
    }
    out
}

/// The compact DESIGN.md for `design`, whose directory is `dir`.
pub fn propose(design: &str, dir: &std::path::Path) -> String {
    // The title is the body's first heading: a `# ` line inside the frontmatter is a YAML comment.
    let (frontmatter, body) = split_frontmatter(design);
    let title = body.lines().find_map(|l| l.strip_prefix("# ")).map(str::trim).unwrap_or("Design");
    let map = design_map::map(design, dir, ARCHIVE);
    let frontmatter = without_comments(frontmatter);
    let mut out = String::new();
    out.push_str(&frontmatter);
    if !frontmatter.is_empty() && !frontmatter.ends_with("\n\n") {
        out.push('\n');
    }
    out.push_str(&format!("# {title}\n\n{map}\n"));
    out
}

/// A DESIGN.md longer than the map `context` carries in its place (doctor only): what compacting it would save, and how,
/// with the person's consent.
pub fn check_sprawl(design: Option<&str>, design_path: Option<&str>) -> Vec<crate::staleness::Finding> {
    let (Some(design), Some(rel)) = (design, design_path) else { return vec![] };
    if design.trim().len() <= MAP_BUDGET {
        return vec![];
    }
    vec![crate::staleness::finding(
        "design-md-sprawl",
        "DESIGN.md",
        Some(rel.to_string()),
        "route",
        format!("{rel} is {} bytes, so `context` carries a map of it and agents read the whole file only for detail.", design.len()),
        "Run `impeccable design-compact` to see DESIGN.md as its map and what that saves; show the person, and add `--write` only once they agree (the original moves to .impeccable/design-full.md).".to_string(),
    )]
}

pub fn run(args: &[String], io: &mut Io) -> i32 {
    let mut write = false;
    let mut passthrough = Vec::new();
    for a in args {
        match a.as_str() {
            "--write" => write = true,
            "--help" | "-h" => {
                io.out(&format!("{}\n", usage()));
                return 0;
            }
            _ => passthrough.push(a.clone()),
        }
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
    if design.trim().len() <= MAP_BUDGET {
        io.out(&format!("{rel} is already short ({} bytes): it is carried whole, with nothing to compact.\n", design.len()));
        return 0;
    }
    let dir = std::path::Path::new(&path).parent().map(std::path::Path::to_path_buf).unwrap_or_default();
    let proposal = propose(&design, &dir);
    let (before, after) = (design.len(), proposal.len());
    if !write {
        io.out(&format!(
            "{proposal}\n---\n{rel}: {before} bytes now, {after} as the map (saves {} bytes, about {} tokens each time it is read).\n\
The original would move to {ARCHIVE}, where the map points for any section's detail.\n\
Show this to the person; write it with `impeccable design-compact --write` only once they agree.\n",
            before - after.min(before),
            (before - after.min(before)) / 4
        ));
        return 0;
    }
    let archive = dir.join(ARCHIVE);
    if archive.exists() {
        io.err(&format!("{} already exists: nothing written. Move it aside first.\n", archive.display()));
        return 1;
    }
    let written = std::fs::create_dir_all(archive.parent().unwrap_or(&dir))
        .and_then(|_| std::fs::write(&archive, &design))
        .and_then(|_| {
            // The map replaces DESIGN.md in one rename, so a reader never sees half of it.
            let tmp = dir.join(".DESIGN.md.compact");
            std::fs::write(&tmp, &proposal)?;
            std::fs::rename(&tmp, &path)
        });
    match written {
        Ok(()) => {
            io.out(&format!("{rel} is now its map ({after} bytes); the original is in {ARCHIVE}.\n"));
            0
        }
        Err(e) => {
            io.err(&format!("Nothing changed in {rel}: {e}\n"));
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_frontmatter_as_written_and_points_the_map_at_the_original() {
        let design = "---\nname: Demo\n# A comment, not the title.\ncolors:\n  brand: \"#c8552b\"\n---\n\n# Demo Design\n\n**The One Accent Rule.** Brand is under 10% of a screen. More words.\n\n## Don'ts\n\n- Don't add drop shadows to cards.\n";
        let out = propose(design, std::path::Path::new("."));
        assert!(out.starts_with("---\nname: Demo\ncolors:\n  brand: \"#c8552b\"\n---\n"), "{out}");
        assert!(out.contains("\n# Demo Design\n") && !out.contains("A comment"), "{out}");
        assert!(out.contains("The One Accent Rule. Brand is under 10% of a screen."), "{out}");
        assert!(out.contains("Don't add drop shadows to cards"), "{out}");
        assert!(out.contains(&format!("Full: {ARCHIVE}")), "{out}");
    }

    /// Catches a compaction the detector would read differently: this repo's own DESIGN.md, compacted, parses to the
    /// same frontmatter (colours, fonts and every other key the detector's allowlists come from).
    #[test]
    fn this_repo_compacts_to_the_same_frontmatter_and_far_fewer_bytes() {
        let design = include_str!("../../../DESIGN.md");
        let root = std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
        let out = propose(design, root);
        let parse = |t: &str| crate::design_parser::parse_design_md(t).frontmatter;
        assert_eq!(parse(&out), parse(design));
        assert!(out.len() * 3 < design.len(), "{} of {} bytes", out.len(), design.len());
    }

    #[test]
    fn drops_yaml_comments_but_never_a_quoted_hash() {
        let fm = "---\n# All values mirror tokens.css.\ncolors:\n  brand: \"#c8552b\"   # the accent\n  ink: oklch(14% 0 0) # text\n  note: 'a # in quotes' # gone\n---\n";
        assert_eq!(without_comments(fm), "---\ncolors:\n  brand: \"#c8552b\"\n  ink: oklch(14% 0 0)\n  note: 'a # in quotes'\n---\n");
    }

    #[test]
    fn a_file_without_frontmatter_keeps_none() {
        assert_eq!(split_frontmatter("# D\n\nbody\n"), ("", "# D\n\nbody\n"));
        assert_eq!(split_frontmatter("---\na: 1\n---\nrest\n"), ("---\na: 1\n---\n", "rest\n"));
    }
}
