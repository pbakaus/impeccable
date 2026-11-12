//! Foundations: the 18-item roadmap every project needs. A full `detect`
//! and `impeccable foundations` settle what they can from the project's
//! files and the detector, and a signed-in CLI with foundations consent
//! uploads the states (`impeccable_account::health`). An item with no
//! evidence either way is left out, never sent as a pass.

mod local;

use impeccable_common::Io;
use std::collections::BTreeMap;

/// Every item, in roadmap order: launch, then paying, then scale. The
/// service rejects a whole upload with an id it doesn't know.
const ITEMS: &[(&str, &str, &str)] = &[
    (
        "secrets-out-of-repo",
        "No secrets in the repository",
        "A key in a tracked file is a key anyone with the code can use.",
    ),
    (
        "readable-contrast",
        "Readable contrast",
        "Text people can't read is text that isn't there.",
    ),
    (
        "no-generic-ai-patterns",
        "No generic AI patterns",
        "Stock gradients and card grids make a product look like every other one.",
    ),
    (
        "not-found-page",
        "A real not-found page",
        "A broken link should land somewhere helpful, not on a blank error.",
    ),
    (
        "app-icons",
        "App icons",
        "Tabs, bookmarks and home screens show your icon, or a generic one.",
    ),
    (
        "social-previews",
        "Social previews",
        "A shared link with an image gets clicked; a bare URL gets scrolled past.",
    ),
    (
        "legal-pages",
        "Legal pages",
        "Payment providers, app stores and people signing up look for them.",
    ),
    (
        "readme-runs",
        "A README that runs",
        "The next person, or agent, starts from the README's commands.",
    ),
    (
        "ci-runs-tests",
        "CI runs the tests",
        "Tests that only run on one laptop stop running.",
    ),
    (
        "design-tokens",
        "Design tokens",
        "Named colors keep a product consistent as it grows.",
    ),
    (
        "reduced-motion",
        "Reduced motion respected",
        "Some people get sick from motion; their system asks you to tone it down.",
    ),
    (
        "real-packages",
        "Only real packages",
        "An agent can invent a package name that someone else then registers.",
    ),
    (
        "dependency-scanning",
        "Dependency scanning",
        "Known holes in old packages get patched only if someone hears about them.",
    ),
    (
        "error-tracking",
        "Error tracking",
        "You hear about errors from a dashboard, not from customers leaving.",
    ),
    (
        "reversible-migrations",
        "Reversible migrations",
        "A bad migration you can undo is an incident; one you can't is an outage.",
    ),
    (
        "no-giant-files",
        "No giant files",
        "Files past 1,000 lines are where agents and people make mistakes.",
    ),
    (
        "current-dependencies",
        "Current dependencies",
        "Far-behind packages turn every upgrade into a project.",
    ),
    (
        "infrastructure-as-code",
        "Infrastructure as code",
        "Hosting set up in files can be rebuilt, reviewed and moved.",
    ),
];

/// The states a full scan supports: the project's own files, then the
/// detector's two classes. A detector failure wins over a file pass.
pub(crate) fn from_scan(
    root: &str,
    full: &impeccable_detect::cli::FullScan,
) -> BTreeMap<String, String> {
    let mut items: BTreeMap<String, String> = BTreeMap::new();
    // Only a git work tree's top uploads; don't walk anything else.
    if std::path::Path::new(root).join(".git").exists() {
        for (id, s) in local::scan(std::path::Path::new(root)).items {
            items.insert(id.to_string(), s.as_str().to_string());
        }
    }
    for (id, s) in detector(full) {
        items.insert(id.to_string(), s.to_string());
    }
    items
}

/// The detector's two classes. A pass means "none found by the scan", and
/// only where the scan ran those rules on files they can judge.
fn detector(full: &impeccable_detect::cli::FullScan) -> BTreeMap<&'static str, &'static str> {
    let slop: Vec<&str> = impeccable_core::registry::ANTIPATTERNS
        .iter()
        .filter(|r| r.category == "slop")
        .map(|r| r.id)
        .collect();
    let class = |rule: &str| {
        if rule == "low-contrast" {
            Some("readable-contrast")
        } else if slop.contains(&rule) {
            Some("no-generic-ai-patterns")
        } else {
            None
        }
    };
    let mut out = BTreeMap::new();
    let mut advisory = Vec::new();
    for f in &full.findings {
        let Some(id) = class(&f.antipattern) else {
            continue;
        };
        if f.advisory == Some(true) {
            advisory.push(id);
        } else {
            out.insert(id, "failing");
        }
    }
    let enabled = |id: &str| full.ruleset.iter().any(|r| r == id);
    // `--no-advisory` hides the uncertain findings a pass must not ignore.
    if full.ruleset.iter().any(|r| r == "no-advisory=true") {
        return out;
    }
    // Low contrast runs only where the static HTML engine reads the page, so
    // a component the regex engine read leaves the pass unproven.
    if full.html_files_scanned > 0
        && full.regex_component_files == 0
        && enabled("low-contrast")
        && !advisory.contains(&"readable-contrast")
    {
        out.entry("readable-contrast").or_insert("checked");
    }
    if full.ui_files_scanned > 0
        && slop.iter().all(|r| enabled(r))
        && !advisory.contains(&"no-generic-ai-patterns")
    {
        out.entry("no-generic-ai-patterns").or_insert("checked");
    }
    out
}

/// `impeccable foundations [path] [--json]`.
pub(crate) fn run(
    args: &[String],
    io: &mut Io,
    engines: &impeccable_detect::Engines,
    rule_pack: Option<&'static dyn impeccable_core::rule_pack::RulePack>,
) -> i32 {
    let mut json = false;
    let mut path = None;
    for a in args {
        match a.as_str() {
            "--json" => json = true,
            "--help" | "-h" => {
                io.out(USAGE);
                return 0;
            }
            s if s.starts_with('-') => {
                io.err(&format!("Unknown option: {s}\n\n{USAGE}"));
                return 1;
            }
            s if path.is_none() => path = Some(s.to_string()),
            _ => {
                io.err(USAGE);
                return 1;
            }
        }
    }
    let root = io.cwd.join(path.as_deref().unwrap_or("."));
    let Ok(root) = root.canonicalize() else {
        io.err(&format!("No such folder: {}\n", root.display()));
        return 1;
    };
    if !root.is_dir() {
        io.err(&format!("Not a folder: {}\n", root.display()));
        return 1;
    }
    let started = std::time::SystemTime::now();
    let local = local::scan(&root);
    // The detector's two classes, through the same full scan `detect` runs,
    // with its output kept off the terminal.
    let mut full = None;
    if !local.empty {
        let stdout = std::mem::replace(&mut io.stdout, Box::new(std::io::sink()));
        let stderr = std::mem::replace(&mut io.stderr, Box::new(std::io::sink()));
        let scan_args = vec!["--json".to_string(), root.to_string_lossy().into_owned()];
        impeccable_detect::cli::run_detect_reporting(&scan_args, io, engines, rule_pack, &mut full);
        io.stdout = stdout;
        io.stderr = stderr;
    }
    let mut items: BTreeMap<String, String> = local
        .items
        .iter()
        .map(|(id, s)| (id.to_string(), s.as_str().to_string()))
        .collect();
    if let Some(full) = &full {
        for (id, s) in detector(full) {
            items.insert(id.to_string(), s.to_string());
        }
    }
    let next = ITEMS
        .iter()
        .find(|(id, ..)| items.get(*id).map(String::as_str) == Some("failing"))
        .map(|(id, ..)| *id);
    if json {
        let body = serde_json::json!({ "items": items, "next": next });
        io.out(&format!(
            "{}\n",
            serde_json::to_string_pretty(&body).unwrap_or_default()
        ));
    } else {
        print_roadmap(io, &items, next, &local);
    }
    // Upload exactly as a full `detect` does: only a real full scan, and
    // only of a git work tree's top (health checks both).
    if let Some(full) = full {
        if impeccable_account::health::wanted(io) {
            let scan = crate::router::health_scan(full, items, started);
            impeccable_account::health::after_scan(io, &scan, json);
        }
    }
    0
}

const USAGE: &str = "Usage: impeccable foundations [path] [--json]\n\nChecks the product foundations this project's files can show: CI, icons, 404 page, secrets and more.\n";

fn print_roadmap(
    io: &mut Io,
    items: &BTreeMap<String, String>,
    next: Option<&str>,
    local: &local::Report,
) {
    if local.empty {
        io.out("Nothing to check yet: this folder has no files. Run it again once the project has some.\n");
        return;
    }
    let state = |id: &str| items.get(id).map(String::as_str);
    let in_place = items.values().filter(|s| *s != "failing").count();
    io.out(&format!(
        "Foundations: {in_place} of {} in place\n",
        items.len()
    ));
    if let Some(id) = next {
        let (_, title, why) = ITEMS.iter().find(|(i, ..)| *i == id).expect("listed item");
        io.out(&format!("\nNext up: {title}\n  {why}\n"));
        if id == "secrets-out-of-repo" {
            for s in local.secrets.iter().take(5) {
                io.out(&format!("  {}:{} ({})\n", s.file, s.line, s.kind));
            }
        }
        if id == "no-giant-files" {
            for (f, lines) in local.giant_files.iter().take(5) {
                io.out(&format!("  {f} ({lines} lines)\n"));
            }
        }
        io.out(&format!("  Ask your agent: /impeccable foundations {id}\n"));
    } else if !items.is_empty() {
        io.out("\nEverything checked is in place.\n");
    }
    io.out("\n");
    for (id, title, _) in ITEMS {
        if Some(*id) == next {
            continue;
        }
        let line = match state(id) {
            Some("failing") => format!("✗ {title}  ({id})"),
            Some(_) => format!("✓ {title}"),
            None => format!("· {title}  (not checked)"),
        };
        io.out(&format!("{line}\n"));
    }
}
