//! `justified-text` fires only where justification can open rivers: a narrow
//! column, no automatic hyphenation, and a script that justifies by
//! stretching word spaces.

use impeccable_html::{detect_html_source, DetectHtmlOptions};
use std::path::Path;

fn page(style: &str, body: &str) -> String {
    format!(
        "<!DOCTYPE html><html lang=\"en\"><head><style>{style}</style></head><body>{body}</body></html>"
    )
}

fn justified_hits(html: &str) -> usize {
    detect_html_source(html, Path::new("/tmp/justified.html"), &DetectHtmlOptions::default())
        .iter()
        .filter(|f| f.antipattern == "justified-text")
        .count()
}

fn repo_root() -> std::path::PathBuf {
    std::env::var("IMPECCABLE_PUBLIC_REPO")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."))
}

const LATIN: &str = "Forcing every line of a column this narrow out to the same width leaves only a handful of word spaces to carry the slack, so each one opens up until the gaps line up vertically.";
const CHINESE: &str = "永慶房屋於一九八八年成立，專注本業，堅持創新，秉持先誠實再成交的精神，提供消費者透明的資訊與安心的服務，目前在雙北地區有逾二百八十家直營門市。";
const THAI: &str = "การจัดวางข้อความแบบชิดขอบทั้งสองด้านในภาษาไทยไม่ได้ดึงช่องว่างระหว่างคำให้กว้างขึ้นเพราะโดยปกติแล้วภาษาไทยไม่ได้เว้นวรรคระหว่างคำ";
const ARABIC: &str = "يعتمد ضبط النص في الخط العربي على استطالة الحروف على السطر بدلا من توسيع المسافات بين الكلمات، ولذلك تبقى المسافات متساوية ولا تظهر الفجوات البيضاء.";

#[test]
fn narrow_latin_column_flags() {
    let html = page(
        "p { text-align: justify; width: 300px; font-size: 16px; }",
        &format!("<p>{LATIN}</p>"),
    );
    assert_eq!(justified_hits(&html), 1, "{html}");
}

#[test]
fn narrow_column_declared_on_an_ancestor_flags() {
    let html = page(
        ".sidebar { width: 240px; } .sidebar p { text-align: justify; font-size: 16px; }",
        &format!("<div class=\"sidebar\"><p>{LATIN}</p></div>"),
    );
    assert_eq!(justified_hits(&html), 1, "{html}");
}

#[test]
fn the_threshold_measure_still_flags() {
    // 360px at 16px is exactly 45 characters per line, the widest measure
    // real pages still showed rivers at.
    let html = page(
        "p { text-align: justify; width: 360px; font-size: 16px; }",
        &format!("<p>{LATIN}</p>"),
    );
    assert_eq!(justified_hits(&html), 1, "{html}");
}

#[test]
fn wide_column_passes() {
    let html = page(
        "p { text-align: justify; width: 760px; font-size: 16px; }",
        &format!("<p>{LATIN}</p>"),
    );
    assert_eq!(justified_hits(&html), 0, "{html}");
}

#[test]
fn hyphens_auto_passes() {
    let html = page(
        "p { text-align: justify; hyphens: auto; width: 300px; font-size: 16px; }",
        &format!("<p>{LATIN}</p>"),
    );
    assert_eq!(justified_hits(&html), 0, "{html}");
}

#[test]
fn hyphens_manual_still_flags() {
    let html = page(
        "p { text-align: justify; hyphens: manual; width: 300px; font-size: 16px; }",
        &format!("<p>{LATIN}</p>"),
    );
    assert_eq!(justified_hits(&html), 1, "{html}");
}

#[test]
fn grid_and_elongation_scripts_pass() {
    for text in [CHINESE, THAI, ARABIC] {
        let html = page(
            "p { text-align: justify; width: 300px; font-size: 16px; }",
            &format!("<p>{text}</p>"),
        );
        assert_eq!(justified_hits(&html), 0, "{html}");
    }
}

#[test]
fn latin_with_a_few_cjk_characters_still_flags() {
    let html = page(
        "p { text-align: justify; width: 300px; font-size: 16px; }",
        &format!("<p>{LATIN} 永慶房屋</p>"),
    );
    assert_eq!(justified_hits(&html), 1, "{html}");
}

#[test]
fn undeclared_measure_passes() {
    // No layout and no declared width: the static engine cannot tell a narrow
    // column from a long measure, so it does not guess.
    let html = page(
        "p { text-align: justify; font-size: 16px; }",
        &format!("<p>{LATIN}</p>"),
    );
    assert_eq!(justified_hits(&html), 0, "{html}");
}

#[test]
fn fixture_flag_and_pass_cases() {
    let fixture = repo_root().join("tests/fixtures/antipatterns/justified-text.html");
    assert!(fixture.is_file(), "missing fixture at {}", fixture.display());
    let html = std::fs::read_to_string(&fixture).unwrap();
    let findings = detect_html_source(&html, &fixture, &DetectHtmlOptions::default());
    let hits = findings
        .iter()
        .filter(|f| f.antipattern == "justified-text")
        .count();
    assert_eq!(
        hits, 5,
        "expected one hit per should-flag case, got {findings:?}"
    );
}

#[test]
fn text_that_fits_one_line_does_not_flag() {
    // 300px at 32px holds about 18 characters: "Research topics" fits one
    // line, and a lone justified line is set ragged.
    let one_line = page(
        "h2 { text-align: justify; width: 300px; font-size: 32px; }",
        "<h2>Research topics</h2>",
    );
    assert_eq!(justified_hits(&one_line), 0, "{one_line}");
    let wraps = page(
        "h2 { text-align: justify; width: 300px; font-size: 32px; }",
        "<h2>Loss functions and structured prediction</h2>",
    );
    assert_eq!(justified_hits(&wraps), 1, "{wraps}");
}
