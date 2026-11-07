//! Taste calls r3-02 and r3-04 on the static engine: `low-contrast` findings
//! just under their bar, and on text with no reading job, report as advisory
//! (visible, outside the failure count); everything else keeps failing.
//! Fixtures: `tests/fixtures/antipatterns/low-contrast-near-bar.html` and
//! `low-contrast-decorative.html`.

use impeccable_core::findings::Finding;
use impeccable_html::{detect_html_source, DetectHtmlOptions};
use std::path::{Path, PathBuf};

fn repo_root() -> PathBuf {
    std::env::var("IMPECCABLE_PUBLIC_REPO")
        .map(PathBuf::from)
        .unwrap_or_else(|_| Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
}

fn scan_fixture(name: &str) -> Vec<Finding> {
    let path = repo_root().join("tests/fixtures/antipatterns").join(name);
    let html = std::fs::read_to_string(&path).expect("fixture");
    detect_html_source(&html, &path, &DetectHtmlOptions::default())
        .into_iter()
        .filter(|f| f.antipattern == "low-contrast")
        .collect()
}

fn scan(html: &str) -> Vec<Finding> {
    detect_html_source(html, Path::new("/tmp/advisory.html"), &DetectHtmlOptions::default())
        .into_iter()
        .filter(|f| f.antipattern == "low-contrast")
        .collect()
}

/// The finding whose snippet names `needle`, which must be exactly one.
fn one<'a>(findings: &'a [Finding], needle: &str) -> &'a Finding {
    let hits: Vec<&Finding> = findings.iter().filter(|f| f.snippet.contains(needle)).collect();
    assert_eq!(hits.len(), 1, "expected one finding naming {needle}, got {findings:#?}");
    hits[0]
}

fn assert_advisory(f: &Finding) {
    assert_eq!(f.severity, "advisory", "{f:#?}");
    assert_eq!(f.advisory, Some(true), "{f:#?}");
}

fn assert_failing(f: &Finding) {
    assert_eq!(f.severity, "warning", "{f:#?}");
    assert_eq!(f.advisory, None, "{f:#?}");
}

#[test]
fn near_bar_ratios_are_advisory_and_the_rest_fail() {
    let findings = scan_fixture("low-contrast-near-bar.html");
    for needle in [
        "4.2:1 (need 4.5:1) — text #7c7c7c",
        "4.48:1 (need 4.5:1) — text #777777",
        "4.4:1 (need 4.5:1) — text #797979",
        "4.3:1 (need 4.5:1) — text #7a7a7a",
        "2.8:1 (need 3:1) — text #9b9b9b",
        "2.99:1 (need 3:1) — text #959595",
        ":hover state 4.4:1 (need 4.5:1) — text #787878",
    ] {
        assert_advisory(one(&findings, needle));
    }
    for needle in [
        "4.1:1 (need 4.5:1) — text #7d7d7d",
        "4.1:1 (need 4.5:1) — text #7e7e7e",
        "2.7:1 (need 3:1) — text #9c9c9c",
        // r3-08: bold display text under the large-text margin keeps failing.
        "2.7:1 (need 3:1) — text #9e9e9e",
        ":hover state 4.0:1 (need 4.5:1) — text #7f7f7f",
    ] {
        assert_failing(one(&findings, needle));
    }
    for readable in ["#767676", "#757575", "#949494", "#737373"] {
        assert!(findings.iter().all(|f| !f.snippet.contains(readable)), "{findings:#?}");
    }
}

#[test]
fn decorative_shapes_are_advisory_and_uncertain_shapes_fail() {
    let findings = scan_fixture("low-contrast-decorative.html");
    let advisory: Vec<&str> = findings
        .iter()
        .filter(|f| f.severity == "advisory")
        .map(|f| f.snippet.as_str())
        .collect();
    let failing: Vec<&str> = findings
        .iter()
        .filter(|f| f.severity != "advisory")
        .map(|f| f.snippet.as_str())
        .collect();
    // Avatar initials (JD, R), the version and build stamps, both
    // signatures, the marked mockup's labels (one pair) and the role="img"
    // terminal.
    for pair in [
        "#ffffff on #93c5fd",
        "#ffffff on #a5b4fc",
        "#bbbbbb on #ffffff",
        "#c0c0c0 on #ffffff",
        "#c4840e on #f6f1ea",
        "#b0b0b0 on #ffffff",
        "#aaaaaa on #ffffff",
        "#6b7280 on #111827",
    ] {
        assert_eq!(
            advisory.iter().filter(|s| s.contains(pair)).count(),
            1,
            "advisory {pair}: {advisory:#?}"
        );
    }
    assert_eq!(advisory.len(), 8, "{advisory:#?}");
    // The letter that labels a link, a digit badge, three letters, a letter
    // not centred, a version inside a sentence, a script heading, a class
    // that only starts with `signature`, fine print wearing the advisory
    // signature's colour, an unmarked mockup, and copy in a
    // `section.mockups`; then a key in a `kbd`, a lower-case info badge, a
    // version as a heading and as a link, a year after "Release", a
    // `mock-exam`, an `illustration-credit` and a sentence under a
    // `mockups-grid`.
    assert_eq!(failing.len(), 18, "{failing:#?}");
    for pair in [
        "#b0b0b0 on #ffffff",
        "#aaaaaa on #ffffff",
        "#ffffff on #93c5fd",
        "#b5b5b5 on #f6f6f6",
        "#ffffff on #e5e7eb",
        "#b7b7b7 on #ffffff",
        "#b8b8b8 on #ffffff",
        "#b9b9b9 on #ffffff",
        "#a1a1a1 on #ffffff",
        "#a2a2a2 on #ffffff",
        "#a3a3a3 on #ffffff",
    ] {
        assert!(failing.iter().any(|s| s.contains(pair)), "failing {pair}: {failing:#?}");
    }
    assert!(findings.iter().all(|f| !f.snippet.contains("#1d4ed8") && !f.snippet.contains("#4b5563")));
}

#[test]
fn an_advisory_copy_never_speaks_for_a_failing_one() {
    // The avatar comes first and claims its own pair; the plain link after it
    // wearing the same colours still fails, and a second avatar is deduped
    // against the first.
    let html = r##"<!DOCTYPE html><html><head><style>
    body { background: #ffffff; }
    .av { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 50%; color: #bbbbbb; font-size: 14px; border: 1px solid #bbbbbb; }
    a, span { color: #bbbbbb; font-size: 14px; }
    </style></head><body>
    <span class="av">JD</span>
    <span class="av">MK</span>
    <a href="#terms">Read the full terms</a>
    </body></html>"##;
    let findings = scan(html);
    assert_eq!(findings.len(), 2, "{findings:#?}");
    assert_advisory(&findings[0]);
    assert_failing(&findings[1]);
}

#[test]
fn an_initial_is_decorative_only_when_its_box_centres_it() {
    let scan_box = |layout: &str| {
        let html = format!(
            r##"<!DOCTYPE html><html><head><style>
    body {{ background: #ffffff; }}
    .av {{ {layout} width: 40px; height: 40px; border-radius: 50%; color: #bbbbbb; font-size: 14px; border: 1px solid #bbbbbb; }}
    </style></head><body><span class="av">JD</span></body></html>"##
        );
        let findings = scan(&html);
        assert_eq!(findings.len(), 1, "{layout}: {findings:#?}");
        findings[0].severity.clone()
    };
    assert_eq!(scan_box("display: flex; align-items: center; justify-content: center;"), "advisory");
    assert_eq!(scan_box("display: grid; place-items: center;"), "advisory");
    assert_eq!(scan_box("--a: center; display: grid; place-items: var(--a);"), "advisory");
    assert_eq!(scan_box("--a: center stretch; display: grid; place-items: var(--a);"), "warning");
    // A flex or grid box that leaves the initial in a corner.
    assert_eq!(scan_box("display: flex; align-items: center; justify-content: flex-start;"), "warning");
    assert_eq!(scan_box("display: flex; align-items: flex-start; justify-content: center;"), "warning");
    assert_eq!(scan_box("display: grid;"), "warning");
}

#[test]
fn a_failing_copy_first_hides_later_advisory_copies() {
    let html = r##"<!DOCTYPE html><html><head><style>
    body { background: #ffffff; }
    a, span { color: #bbbbbb; font-size: 14px; }
    .av { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border: 1px solid #bbbbbb; }
    </style></head><body>
    <a href="#terms">Read the full terms</a>
    <span class="av">JD</span>
    </body></html>"##;
    let findings = scan(html);
    assert_eq!(findings.len(), 1, "{findings:#?}");
    assert_failing(&findings[0]);
}

/// r5-p30: a placeholder under a visible label is a hint. The file scan
/// reads label elements and `aria-labelledby`; plain text above a field
/// needs layout, so that row keeps its severity here.
#[test]
fn a_placeholder_under_a_visible_label_is_advisory() {
    let findings = scan_fixture("low-contrast-labelled-placeholders.html");
    for only_label in [
        "Work email address",
        "Company website link",
        "Search trials and targets",
        "Plate number or VIN",
        "Look up a compound",
        "Newsletter email address",
        "Family name goes here",
        "Where do you work today",
    ] {
        assert_failing(one(&findings, only_label));
    }
    for hint in [
        "Optional for individuals",
        "What are you working on this quarter",
        "Include the country code",
        "What should we call you",
        "Where the parcel goes",
    ] {
        assert_advisory(one(&findings, hint));
    }
    assert_eq!(findings.len(), 13, "{findings:#?}");
}

/// r5-p31: a family named as a bold cut takes the large-text bar at computed
/// weight 400.
#[test]
fn a_family_named_as_a_bold_cut_takes_the_large_text_bar() {
    let findings = scan_fixture("low-contrast-heavy-faces.html");
    for (surface, bar) in [
        ("#ff572a", "(need 4.5:1)"),
        ("#ff5757", "(need 4.5:1)"),
        ("#f93258", "(need 4.5:1)"),
        ("#f41987", "(need 4.5:1)"),
        ("#fa6400", "(need 4.5:1)"),
        ("#ff9494", "(need 3:1)"),
    ] {
        let f = one(&findings, surface);
        assert!(f.snippet.contains(bar), "{f:#?}");
        assert_failing(f);
    }
    assert_eq!(findings.len(), 6, "{findings:#?}");
}

#[test]
fn a_unitless_line_height_matching_the_avatar_height_centres_its_initials() {
    let avatar = |css: &str| {
        format!(
            r##"<!DOCTYPE html><html><head><style>
    body {{ background: #ffffff; }}
    .av {{ display: block; width: 40px; height: 40px; border-radius: 50%; background: #93c5fd; color: #ffffff; {css} }}
    </style></head><body><div class="av">JD</div></body></html>"##
        )
    };
    let tall = scan(&avatar("font-size: 20px; line-height: 2;"));
    assert_eq!(tall.len(), 1, "{tall:#?}");
    assert_advisory(&tall[0]);

    let inherited =
        scan(&avatar("font-size: 20px;").replace("body {", "body { line-height: 2;"));
    assert_eq!(inherited.len(), 1, "{inherited:#?}");
    assert_advisory(&inherited[0]);

    let short = scan(&avatar("font-size: 20px; line-height: 1;"));
    assert_eq!(short.len(), 1, "{short:#?}");
    assert_failing(&short[0]);
}
