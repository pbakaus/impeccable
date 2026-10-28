//! Premise round 4 on the static engine: three contexts in which a
//! typography finding reports as advisory (visible, outside the failure
//! count), and the neighbours that keep failing.
//!
//! - r5-p3: `undersized-ui-text` on a label with no reading job
//!   (`undersized-ui-text-micro-labels.html`).
//! - r5-p27: `tiny-text` and `tight-leading` on legal fine print
//!   (`fine-print.html`; `line-length` needs layout).
//! - r5-p26: `undersized-ui-text`, `tiny-text` and `low-contrast` inside a
//!   framed HTML demo read from structure (`mockup-structure.html`).
//! - r6-t3: `nested-cards` on an inner card in a framed demo or under
//!   `role="img"` (`nested-cards-mockups.html`).
//!
//! There is no layout here, so the rows that need rects keep failing: a
//! label drawn over a plot and labels lined up along an axis.

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
}

fn scan(body: &str) -> Vec<Finding> {
    let html = format!("<!DOCTYPE html><html><head></head><body>{body}</body></html>");
    detect_html_source(&html, Path::new("/tmp/advisory-contexts.html"), &DetectHtmlOptions::default())
}

/// The severities of every `rule` finding whose snippet quotes `label`.
fn severities<'a>(findings: &'a [Finding], rule: &str, label: &str) -> Vec<&'a str> {
    findings
        .iter()
        .filter(|f| f.antipattern == rule && f.snippet.contains(&format!("\"{label}\"")))
        .map(|f| f.severity.as_str())
        .collect()
}

fn count(findings: &[Finding], rule: &str, advisory: bool) -> usize {
    findings
        .iter()
        .filter(|f| f.antipattern == rule && (f.severity == "advisory") == advisory)
        .count()
}

#[test]
fn micro_labels_are_advisory_and_read_text_fails() {
    let f = scan_fixture("undersized-ui-text-micro-labels.html");
    for label in ["Popular", "What's inside", "Most popular", "Best value", "Q3"] {
        assert_eq!(severities(&f, "undersized-ui-text", label), ["advisory"], "{label}");
    }
    for label in [
        "Also included",
        "Noticed on its own",
        "committed volume",
        "Case studies",
        "From $9",
        "Save 20%",
        "September 17",
        "Overview",
        "Optional",
        "Customers",
        "Truck fleets",
        "12",
        "How-To",
        "Sampled hourly",
        // No layout: a label over a plot and an axis run keep failing here.
        "60 Hz display",
        "7 am",
    ] {
        assert_eq!(severities(&f, "undersized-ui-text", label), ["warning"], "{label}");
    }
    // The same text in both columns: once failing, once advisory.
    for label in ["New", "Days", "01"] {
        let mut s = severities(&f, "undersized-ui-text", label);
        s.sort_unstable();
        assert_eq!(s, ["advisory", "warning"], "{label}");
    }
    assert_eq!(count(&f, "undersized-ui-text", true), 8, "{f:#?}");
    for a in f.iter().filter(|f| f.severity == "advisory") {
        assert_eq!(a.advisory, Some(true), "{a:#?}");
    }
}

#[test]
fn fine_print_is_advisory_and_a_consent_label_fails() {
    let f = scan_fixture("fine-print.html");
    // Advisory under tiny-text: a small element, an asterisk, a leading
    // sup, an input hint in a small, a terms row, a disclosure widget's
    // panel, a footnote accordion, a footnote inside it and a `text-footnote` class. A legal class, a
    // disclaimer id, a paragraph under a marked list, a disclaimer banner
    // and a footnote report no tiny-text (decision 3, round 13).
    assert_eq!(count(&f, "tiny-text", true), 9, "{f:#?}");
    for quote in ["Requires a new line", "Offer available through", "Trade-in values vary", "Mercury is a financial", "for how the annual yield"] {
        assert!(
            !f.iter().any(|x| x.antipattern == "tiny-text" && x.snippet.contains(quote)),
            "{quote}: {f:#?}"
        );
    }
    // tight-leading stays advisory in both tiers: the fourteen 11px rows.
    assert_eq!(count(&f, "tight-leading", true), 14, "{f:#?}");
    // Links inside a footnote and a terms row keep undersized-ui-text.
    for quote in ["rate disclosure", "Privacy"] {
        let links: Vec<&str> = f
            .iter()
            .filter(|x| x.antipattern == "undersized-ui-text" && x.snippet.contains(quote))
            .map(|x| x.severity.as_str())
            .collect();
        assert_eq!(links, ["warning"], "{quote}: {f:#?}");
    }
    // Failing: unmarked copy, a marker four levels up and a form hint
    // (tiny-text); unmarked copy, the consent label and the far marker
    // (tight-leading).
    assert_eq!(count(&f, "tiny-text", false), 3, "{f:#?}");
    assert_eq!(count(&f, "tight-leading", false), 3, "{f:#?}");
    // The consent label keeps its own finding at full severity.
    let consent: Vec<&Finding> = f
        .iter()
        .filter(|f| f.antipattern == "undersized-ui-text" && f.snippet.contains("I agree that"))
        .collect();
    assert_eq!(consent.len(), 1, "{f:#?}");
    assert_eq!(consent[0].severity, "warning");
    assert!(f.iter().any(|f| f.antipattern == "tight-leading"
        && f.severity == "warning"
        && f.snippet.contains("1.20x")));
}

#[test]
fn a_custom_checkbox_rows_label_is_not_fine_print() {
    // The input sits beside the span that labels it, not around it.
    let f = scan(
        "<div class=\"legal\"><input type=\"checkbox\"><span style=\"font-size: 10px\">I agree that my data is processed under the terms above.</span></div>\
         <div class=\"legal\"><span style=\"font-size: 10px\">Prices include VAT where it applies to the order.</span></div>",
    );
    // A control elsewhere in the container does not make the note a label:
    // under `legal` it is exempt, under `terms` advisory.
    let g = scan(
        "<div class=\"legal\"><span style=\"font-size: 10px\">Prices include VAT where it applies to the order.</span><p>Questions?</p><button>Contact us</button></div>",
    );
    assert!(!g.iter().any(|x| x.antipattern == "tiny-text"), "{g:#?}");
    let h = scan(
        "<div class=\"terms\"><span style=\"font-size: 10px\">Prices include VAT where it applies to the order.</span><p>Questions?</p><button>Contact us</button></div>",
    );
    let sev: Vec<&str> = h.iter().filter(|x| x.antipattern == "tiny-text").map(|x| x.severity.as_str()).collect();
    assert_eq!(sev, vec!["advisory"], "{h:#?}");
    // The checkbox row's label keeps failing; the VAT note is a legal block.
    let got: Vec<&str> = f.iter().filter(|x| x.antipattern == "tiny-text").map(|x| x.severity.as_str()).collect();
    assert_eq!(got, vec!["warning"], "{f:#?}");
}

#[test]
fn text_in_a_framed_demo_is_advisory_under_three_rules() {
    let f = scan_fixture("mockup-structure.html");
    for label in ["847 results", "coldtea.ai", "Metadata mapping", "mail.google.com"] {
        assert_eq!(severities(&f, "undersized-ui-text", label), ["advisory"], "{label}");
    }
    // r8-t1: a sample caption on the panel or beside it.
    for label in ["Confidence", "Recommendation", "Falls by time of day"] {
        assert_eq!(severities(&f, "undersized-ui-text", label), ["advisory"], "{label}");
    }
    // A sentence with the word in it, a label that is no sample claim, a
    // button in a captioned panel, and the caption itself.
    for label in ["Mapping fields", "Mono channel", "Approve", "Sample data"] {
        assert_eq!(severities(&f, "undersized-ui-text", label), ["warning"], "{label}");
    }
    for label in [
        "Ready",
        "Slide two",
        "Simulated preview",
        "See plans",
        "Any agent",
        "Starter",
        "Jane Doe",
        "Back face",
        "Best tool we bought",
        "Nearly level",
        "Synced",
        "Paid",
    ] {
        assert_eq!(severities(&f, "undersized-ui-text", label), ["warning"], "{label}");
    }
    // Both preview captions fail; the label under the framed one is advisory
    // and the one under the unframed box fails, and likewise the scaled
    // frame and the scaled plain box.
    assert_eq!(severities(&f, "undersized-ui-text", "Live preview"), ["warning", "warning"]);
    for label in ["Draft saved", "8:24 AM"] {
        let mut s = severities(&f, "undersized-ui-text", label);
        s.sort_unstable();
        assert_eq!(s, ["advisory", "warning"], "{label}");
    }
    // tiny-text: the short run in the window is advisory; the sentence and
    // the code line in the dotted config window (r14-t7) fail.
    assert_eq!(count(&f, "tiny-text", true), 1, "{f:#?}");
    assert_eq!(count(&f, "tiny-text", false), 2, "{f:#?}");
    assert_eq!(severities(&f, "undersized-ui-text", "timeout_ms = 3000"), ["warning"]);
    // low-contrast: the dim label in the window is advisory.
    let dim: Vec<&Finding> = f
        .iter()
        .filter(|f| f.antipattern == "low-contrast" && f.snippet.contains("#b4b4b4"))
        .collect();
    assert_eq!(dim.len(), 1, "{f:#?}");
    assert_eq!(dim[0].severity, "advisory");
}

#[test]
fn a_transform_in_a_stylesheet_is_not_seen() {
    // The static cascade carries no transform, so a frame transformed by a
    // rule keeps failing: the engine cannot determine the fact.
    let html = "<!DOCTYPE html><html><head><style>\
        .shot { transform: scale(0.7); border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.2); width: 400px; height: 150px; }\
        .small { font-size: 9px; }</style></head><body>\
        <div class=\"shot\"><div><span class=\"small\">8:24 AM</span></div></div></body></html>";
    let f = detect_html_source(html, Path::new("/tmp/advisory-contexts.html"), &DetectHtmlOptions::default());
    assert_eq!(severities(&f, "undersized-ui-text", "8:24 AM"), ["warning"], "{f:#?}");
}

#[test]
fn a_class_marked_mockup_reports_small_text_as_advisory() {
    // `illustration` marks a mockup for low-contrast (r3-04); the same mock
    // context now reaches undersized-ui-text.
    let f = scan(
        "<div class=\"hero-illustration\"><span style=\"font-size: 9px\">Ready</span></div>\
         <div class=\"hero-card\"><span style=\"font-size: 9px\">Queued</span></div>",
    );
    assert_eq!(severities(&f, "undersized-ui-text", "Ready"), ["advisory"], "{f:#?}");
    assert_eq!(severities(&f, "undersized-ui-text", "Queued"), ["warning"], "{f:#?}");
}

#[test]
fn nested_cards_in_a_mockup_are_advisory() {
    let f = scan_fixture("nested-cards-mockups.html");
    // Five inner cards in mockups (in a three-dot window, in a tilted frame,
    // a three-dot window inside a card, a window under a scaled wrapper
    // inside a card, a `role="img"` subtree); three paseo.sh cards in a
    // plain panel, one under a two-dot bar, a card fanned at full size and
    // one under a mockup class keep failing.
    // r8-t1 adds a panel with an illustrative footer note (advisory) and
    // one whose footer is a sentence with the word "example" in it (fails).
    // Round 14 adds a window whose title bar follows an aria-hidden glow
    // (advisory), a phone, which only a measured box shows (fails here), and
    // a phone-shaped shell that holds the page's h1 (fails), and r14-t7 a
    // card in a dotted window that holds code (fails).
    assert_eq!(count(&f, "nested-cards", true), 7, "{f:#?}");
    // One panel, one finding (r14-t5): the three paseo.sh cards report once,
    // counting two more, so ten failing cards are eight findings.
    assert_eq!(count(&f, "nested-cards", false), 8, "{f:#?}");
    assert!(
        f.iter().any(|x| x.antipattern == "nested-cards" && x.snippet == "Card inside card (div) (and 2 more)"),
        "{f:#?}"
    );
}

#[test]
fn a_control_inside_a_marked_mockup_keeps_failing() {
    // A usable button in an illustrated card: its label is a control's, not
    // a picture's.
    let f = scan(
        "<div class=\"hero-illustration\"><span style=\"font-size: 9px\">Ready</span>\
         <button style=\"font-size: 9px\">Try it</button></div>",
    );
    assert_eq!(severities(&f, "undersized-ui-text", "Ready"), ["advisory"], "{f:#?}");
    assert_eq!(severities(&f, "undersized-ui-text", "Try it"), ["warning"], "{f:#?}");
}

#[test]
fn an_inline_rotate_is_read_with_the_scale() {
    // A frame turned 2 degrees by the `rotate` property is not a picture; one
    // turned 10 degrees and scaled down is.
    let frame = "width: 320px; height: 240px; border: 1px solid #d0d7de; border-radius: 12px; scale: 0.78";
    let f = scan(&format!(
        "<div style=\"{frame}; rotate: 2deg\"><span style=\"font-size: 9px\">Nearly level</span></div>\
         <div style=\"{frame}; rotate: 10deg\"><span style=\"font-size: 9px\">Turned card</span></div>"
    ));
    assert_eq!(severities(&f, "undersized-ui-text", "Nearly level"), ["warning"], "{f:#?}");
    assert_eq!(severities(&f, "undersized-ui-text", "Turned card"), ["advisory"], "{f:#?}");
}
