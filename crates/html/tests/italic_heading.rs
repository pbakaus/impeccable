use impeccable_html::{detect_html_source, DetectHtmlOptions};
use std::path::Path;

fn count(body: &str) -> usize {
    let html = format!("<style>h1,h2{{font-family:Georgia,serif;font-size:72px;font-style:normal}} em{{font-style:italic}}</style>{body}");
    detect_html_source(&html, Path::new("/tmp/italic-heading.html"), &DetectHtmlOptions::default())
        .iter().filter(|f| f.antipattern == "italic-serif-display").count()
}

#[test]
fn inline_display_emphasis_is_detected_once_per_heading() {
    assert_eq!(count("<h1>Some places stay with <em>you</em></h1>"), 1);
    assert_eq!(count("<h2><span><em>First</em></span> and <em>second</em></h2>"), 1);
}

#[test]
fn small_sans_hidden_and_roman_text_are_exempt() {
    for style in ["font-size:24px", "font-family:Arial,sans-serif", "font-style:normal", "display:none", "visibility:hidden", "opacity:0"] {
        assert_eq!(count(&format!("<h1>Heading <em style='{style}'>word</em></h1>")), 0, "{style}");
    }
    assert_eq!(count("<h1 style='font-style:italic'> <span style='font-style:normal'>Roman</span></h1>"), 0);
    assert_eq!(count("<h1 style='display:none'><em>Hidden</em></h1>"), 0);
    assert_eq!(count("<h1>Visible <em hidden>Hidden</em></h1>"), 0);
    assert_eq!(count("<h1 hidden><em>Hidden heading</em></h1>"), 0);
    assert_eq!(count("<p style='font:italic 72px Georgia,serif'>Body text</p>"), 0);
}

#[test]
fn semantic_emphasis_and_responsive_display_sizes_are_detected() {
    let scan = |html: &str| detect_html_source(html, Path::new("/tmp/em-heading.html"), &DetectHtmlOptions::default()).into_iter().filter(|f| f.antipattern == "italic-serif-display").count();
    assert_eq!(scan("<h1 style='font-family:Georgia,serif;font-size:clamp(58px,5.55vw,88px)'>Stay with <em><span>you</span></em></h1>"), 1);
    assert_eq!(scan("<h1 style='font-family:Georgia,serif;font-size:72px'>Stay with <em style='font-style:normal'>you</em></h1>"), 0);
    assert_eq!(scan("<h1 style='font-family:Georgia,serif;font-size:clamp(20px,2vw,36px)'>Stay with <em>you</em></h1>"), 0);
}
