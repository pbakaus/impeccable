//! Premise round 4 on the URL engine, over three fixtures rendered by an
//! installed browser. Skips cleanly when there is none.
//!
//! - r5-p3 (`undersized-ui-text-micro-labels.html`): a label with no reading
//!   job reports `undersized-ui-text` as advisory, including the two shapes
//!   only layout can show (a label over a plot, labels along an axis).
//! - r5-p27 (`fine-print.html`): legal fine print reports `line-length`,
//!   `tiny-text` and `tight-leading` as advisory; a consent label fails.
//! - r5-p26 (`mockup-structure.html`): text in a framed HTML demo read from
//!   structure reports `undersized-ui-text`, `tiny-text` and `low-contrast`
//!   as advisory. r8-t1 adds a frame named by a sample caption on it or
//!   beside it, and r8-t2 reports `text-occlusion` as advisory inside any
//!   recognised mockup.
//! - r6-t3 (`nested-cards-mockups.html`): an inner card in a framed demo or
//!   under `role="img"` reports `nested-cards` as advisory; bordered cards in
//!   a bordered panel (paseo.sh) and under a mockup class keep failing.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};

use impeccable_browser::BrowserEngine;
use impeccable_detect::engines::{ScanOptions, UrlEngine};

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/antipatterns")
}

fn serve() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            std::thread::spawn(move || handle(stream));
        }
    });
    port
}

fn handle(mut stream: TcpStream) {
    let mut buf = [0u8; 8192];
    let n = stream.read(&mut buf).unwrap_or(0);
    let request = String::from_utf8_lossy(&buf[..n]);
    let rel = request
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .unwrap_or("/")
        .trim_start_matches('/')
        .to_string();
    let (status, body) = match std::fs::read(fixtures_dir().join(&rel)) {
        Ok(body) if !rel.contains("..") => ("200 OK", body),
        _ => ("404 Not Found", b"missing".to_vec()),
    };
    let head = format!(
        "HTTP/1.0 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&body);
    let _ = stream.flush();
}

/// `(rule, snippet, selector, severity)` for every finding on one fixture,
/// or `None` when no browser is installed.
fn scan(fixture: &str) -> Option<Vec<(String, String, String, String)>> {
    let env: HashMap<String, String> = std::env::vars().collect();
    if impeccable_browser::discovery::find_browser(&env).is_err() {
        eprintln!("skip: no installed browser found");
        return None;
    }
    let engine = BrowserEngine::new(env);
    let port = serve();
    let url = format!("http://127.0.0.1:{port}/{fixture}");
    let findings = engine.detect_url(&url, &ScanOptions::default()).expect("scan");
    Some(
        findings
            .iter()
            .map(|f| {
                let selector =
                    f.extras.get("selector").and_then(|s| s.as_str()).unwrap_or("").to_string();
                assert_eq!(f.advisory == Some(true), f.severity == "advisory", "{f:?}");
                (f.antipattern.clone(), f.snippet.clone(), selector, f.severity.clone())
            })
            .collect(),
    )
}

type Row = (String, String, String, String);

/// The severities of every `rule` finding whose selector names `class`.
fn on<'a>(findings: &'a [Row], rule: &str, class: &str) -> Vec<&'a str> {
    findings
        .iter()
        .filter(|f| f.0 == rule && f.2.contains(class))
        .map(|f| f.3.as_str())
        .collect()
}

/// The severities of every `rule` finding whose snippet quotes `label`.
fn quoting<'a>(findings: &'a [Row], rule: &str, label: &str) -> Vec<&'a str> {
    let mut s: Vec<&str> = findings
        .iter()
        .filter(|f| f.0 == rule && f.1.contains(&format!("\"{label}\"")))
        .map(|f| f.3.as_str())
        .collect();
    s.sort_unstable();
    s
}

#[test]
fn micro_labels_are_advisory() {
    let Some(f) = scan("undersized-ui-text-micro-labels.html") else { return };
    let rule = "undersized-ui-text";
    for label in ["Popular", "What's inside", "Most popular", "Best value", "Q3", "60 Hz display", "7 am", "Noon", "6 pm"] {
        assert_eq!(quoting(&f, rule, label), ["advisory"], "{label}: {f:#?}");
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
    ] {
        assert_eq!(quoting(&f, rule, label), ["warning"], "{label}: {f:#?}");
    }
    for label in ["New", "Days", "01"] {
        assert_eq!(quoting(&f, rule, label), ["advisory", "warning"], "{label}: {f:#?}");
    }
}

#[test]
fn fine_print_is_advisory_under_three_rules() {
    let Some(f) = scan("fine-print.html") else { return };
    // Weaker evidence: advisory under tiny-text and tight-leading.
    for class in ["adv-small", "adv-star", "adv-sup"] {
        assert_eq!(on(&f, "tiny-text", class), ["advisory"], "{class}: {f:#?}");
        assert_eq!(on(&f, "tight-leading", class), ["advisory"], "{class}: {f:#?}");
    }
    assert_eq!(on(&f, "tiny-text", "adv-hint"), ["advisory"], "{f:#?}");
    // A singular `disclosure` widget panel, a footnote-marked accordion and a
    // type-scale `text-footnote` class stay advisory (decision 3 review).
    for class in ["adv-disclosure-panel", "adv-accordion", "adv-inner-footnote", "adv-type-footnote"] {
        assert_eq!(on(&f, "tiny-text", class), ["advisory"], "{class}: {f:#?}");
    }
    assert_eq!(on(&f, "line-length", "adv-faq-wide"), ["advisory"], "{f:#?}");
    assert_eq!(on(&f, "tiny-text", "adv-terms"), ["advisory"], "{f:#?}");
    // A legal or footnote block (decision 3, round 13): exempt from
    // tiny-text, advisory under tight-leading. The id row is named by its id.
    for class in ["adv-class", "#disclaimer-2", "adv-list", "adv-banner"] {
        assert!(on(&f, "tiny-text", class).is_empty(), "{class}: {f:#?}");
        assert_eq!(on(&f, "tight-leading", class), ["advisory"], "{class}: {f:#?}");
    }
    assert!(on(&f, "tiny-text", "#footnote-4").is_empty(), "{f:#?}");
    assert_eq!(on(&f, "tight-leading", "#footnote-4"), ["advisory"], "{f:#?}");
    // Links inside a footnote or a terms row keep undersized-ui-text.
    assert_eq!(on(&f, "undersized-ui-text", "fail-footnote-link"), ["warning"], "{f:#?}");
    assert_eq!(on(&f, "undersized-ui-text", "fail-terms-link"), ["warning"], "{f:#?}");
    for class in ["fail-plain", "fail-deep"] {
        assert_eq!(on(&f, "tiny-text", class), ["warning"], "{class}: {f:#?}");
        assert_eq!(on(&f, "tight-leading", class), ["warning"], "{class}: {f:#?}");
    }
    assert_eq!(on(&f, "tiny-text", "fail-required"), ["warning"], "{f:#?}");
    // The consent label is not fine print under any rule.
    assert_eq!(on(&f, "tight-leading", "fail-consent"), ["warning"], "{f:#?}");
    assert_eq!(on(&f, "undersized-ui-text", "fail-consent"), ["warning"], "{f:#?}");
    // line-length needs layout: the terms row is advisory, the disclaimer
    // row is exempt, and copy fails, a disclaimer at body size included.
    assert_eq!(on(&f, "line-length", "adv-wide"), ["advisory"], "{f:#?}");
    assert!(on(&f, "line-length", "ex-wide").is_empty(), "{f:#?}");
    assert_eq!(on(&f, "line-length", "fail-wide"), ["warning"], "{f:#?}");
    assert_eq!(on(&f, "line-length", "fail-document"), ["warning"], "{f:#?}");
    assert_eq!(on(&f, "line-length", "fail-disclaimer-intro"), ["warning"], "{f:#?}");
}

#[test]
fn a_policy_pages_body_stays_advisory() {
    let Some(f) = scan("fine-print-policy.html") else { return };
    // The legal wrapper holds the page's text outside a footer: advisory.
    let policy = on(&f, "line-length", "adv-policy");
    assert!(!policy.is_empty() && policy.iter().all(|s| *s == "advisory"), "{f:#?}");
    // The legal block in the footer is exempt.
    assert!(on(&f, "line-length", "ex-footer-legal").is_empty(), "{f:#?}");
}

#[test]
fn a_policy_body_with_inner_markers_stays_advisory() {
    let Some(f) = scan("fine-print-policy-nested.html") else { return };
    // Each paragraph carries its own legal marker; the wrapper around them
    // is the page's body, and it settles them.
    let policy = on(&f, "line-length", "adv-policy-nested");
    assert!(!policy.is_empty() && policy.iter().all(|s| *s == "advisory"), "{f:#?}");
    // Should-flag twin: the same marker inside the footer's legal block is exempt.
    assert!(on(&f, "line-length", "ex-footer-legal").is_empty(), "{f:#?}");
}

#[test]
fn a_hidden_copy_does_not_shrink_a_policy_page() {
    let Some(f) = scan("fine-print-policy-hidden.html") else { return };
    let policy = on(&f, "line-length", "adv-policy-visible");
    assert!(!policy.is_empty() && policy.iter().all(|s| *s == "advisory"), "{f:#?}");
    assert!(on(&f, "line-length", "hidden-copy").is_empty(), "{f:#?}");
}

#[test]
fn text_in_a_framed_demo_is_advisory() {
    let Some(f) = scan("mockup-structure.html") else { return };
    let rule = "undersized-ui-text";
    for class in [
        "adv-dots",
        "adv-captioned",
        "adv-scaled",
        "adv-tilted",
        "adv-turned",
        "adv-wrapper",
        // r8-t1: a sample caption on the panel or beside it.
        "adv-pill",
        "adv-footnote",
        "adv-beside",
        // Round 14 (row 1, decision r14-t1): a bar after a glow layer or at
        // the padding edge, a caption labelled up to a comma or called
        // fictional, a phone with a status bar.
        "adv-glow",
        "adv-padded",
        "adv-comma",
        "adv-fictional",
        "adv-phone",
    ] {
        let hits: Vec<&str> = f
            .iter()
            .filter(|r| r.0 == rule && r.2.split(['.', ' ', '>']).any(|p| p == class))
            .map(|r| r.3.as_str())
            .collect();
        assert_eq!(hits, ["advisory"], "{class}: {f:#?}");
    }
    for class in [
        "fail-two-dots",
        "fail-pager",
        "fail-says-so",
        "fail-goes",
        "fail-tab",
        "fail-unframed",
        "fail-bare-scale",
        "fail-scale-90",
        "fail-slide",
        "fail-flipped",
        "fail-polaroid",
        "fail-slight-turn",
        "fail-wrapper-plain",
        "fail-wrapper-small",
        "fail-prose-example",
        "fail-sample-rate",
        "fail-sample-unframed",
        "fail-sample-button",
        "fail-sample-says",
        "fail-phone-no-clock",
        "fail-phone-shell",
        "fail-comma-prose",
        "fail-reel",
        "fail-talk",
        "fail-app-header",
        "fail-caption-sample",
        "fail-caption-fictional",
        "fail-config-small",
    ] {
        assert_eq!(on(&f, rule, class), ["warning"], "{class}: {f:#?}");
    }
    // r8-t2: text covered inside a mockup is advisory; covered page text
    // keeps failing.
    assert_eq!(on(&f, "text-occlusion", "adv-covered"), ["advisory"], "{f:#?}");
    assert_eq!(on(&f, "text-occlusion", "fail-covered-page"), ["warning"], "{f:#?}");
    assert_eq!(on(&f, "tiny-text", "adv-dots-run"), ["advisory"], "{f:#?}");
    assert_eq!(on(&f, "tiny-text", "fail-sentence"), ["warning"], "{f:#?}");
    assert_eq!(on(&f, "low-contrast", "adv-dots-dim"), ["advisory"], "{f:#?}");
    // r14-t7: faint code in a dotted window reports in full.
    assert_eq!(on(&f, "low-contrast", "fail-config-dim"), ["warning"], "{f:#?}");
}

#[test]
fn nested_cards_in_a_mockup_are_advisory() {
    let Some(f) = scan("nested-cards-mockups.html") else { return };
    let rule = "nested-cards";
    for id in [
        "#adv-window-inner",
        "#adv-tilted-inner",
        "#adv-window-itself",
        "#adv-scaled-window",
        "#adv-captioned-panel",
        "#adv-picture-inner",
        "#adv-glow-inner",
        "#adv-phone-inner",
    ] {
        assert_eq!(on(&f, rule, id), ["advisory"], "{id}: {f:#?}");
    }
    // One panel, one finding (r14-t5): the first of paseo.sh's three
    // bordered cards reports and counts the other two.
    assert!(
        f.iter().any(|(r, s, sel, sev)| r == rule
            && s == "Card inside card (and 2 more)"
            && sel == "#fail-panel-a"
            && sev == "warning"),
        "{f:#?}"
    );
    for id in ["#fail-panel-b", "#fail-panel-c"] {
        assert!(on(&f, rule, id).is_empty(), "{id}: {f:#?}");
    }
    for id in [
        "#fail-panel-a",
        "#fail-two-dots-inner",
        "#fail-fanned-inner",
        "#fail-prose-panel",
        "#fail-marked-inner",
        "#fail-shell-inner",
        "#fail-code-inner",
    ] {
        assert_eq!(on(&f, rule, id), ["warning"], "{id}: {f:#?}");
    }
}

/// Row 16 of observations-1010: tiny-text tests SVG text at the size the
/// viewBox scale and an even scale on the text draw it; the snippet keeps the
/// computed size, so corpus clusters do not split.
#[test]
fn svg_text_is_read_at_its_drawn_size() {
    let Some(f) = scan("tiny-text-svg.html") else { return };
    let snippets = |class: &str| -> Vec<&str> {
        f.iter().filter(|r| r.0 == "tiny-text" && r.2.contains(class)).map(|r| r.1.as_str()).collect()
    };
    assert_eq!(snippets("fail-shrunk"), ["14px body text"], "{f:#?}");
    assert_eq!(snippets("fail-near"), ["10.5px body text"], "{f:#?}");
    assert_eq!(snippets("fail-no-viewbox"), ["10px body text"], "{f:#?}");
    assert!(snippets("pass-enlarged").is_empty(), "{f:#?}");
    assert!(snippets("pass-scaled").is_empty(), "{f:#?}");
    assert_eq!(snippets("fail-text-scaled"), ["14px body text"], "{f:#?}");
    assert!(snippets("pass-text-scaled").is_empty(), "{f:#?}");
    assert_eq!(snippets("fail-skewed"), ["10px body text"], "{f:#?}");
    assert_eq!(snippets("fail-padded"), ["10px body text"], "{f:#?}");
    assert_eq!(snippets("fail-inset-shrunk"), ["12px body text"], "{f:#?}");
    assert!(snippets("pass-inset-transformed").is_empty(), "{f:#?}");
}
