//! Element findings carry the line of the element's start tag (#1597).

use impeccable_html::{detect_html_source, DetectHtmlOptions};
use std::path::Path;

fn lines(html: &str) -> Vec<(String, f64)> {
    detect_html_source(html, Path::new("page.html"), &DetectHtmlOptions::default())
        .into_iter()
        .map(|f| (f.antipattern, f.line))
        .collect()
}

#[test]
fn a_single_line_page_reports_line_one() {
    let html = "<!doctype html><html><head><style>.k{color:#777;background:#888}</style></head>\
                <body><p class=\"k\">Faint</p></body></html>";
    assert_eq!(lines(html), [("low-contrast".to_string(), 1.0)]);
}

#[test]
fn a_finding_names_the_line_its_start_tag_opens_on() {
    let html = "<!doctype html>\n<html><head><style>\n\
                .a{color:#777;background:#888}\n\
                .b{color:#666;background:#777}\n\
                .c{color:#555;background:#666}\n\
                </style></head>\n<body>\n\
                <p>Row</p><b class=\"a\">one</b>\n\
                <span\n  class=\"b\"\n>wrapped</span>\n\
                <table>\n  <tr><td class=\"c\">cell</td></tr>\n</table>\n\
                </body></html>\n";
    assert_eq!(
        lines(html),
        [
            ("low-contrast".to_string(), 8.0),
            ("low-contrast".to_string(), 9.0),
            ("low-contrast".to_string(), 13.0),
        ]
    );
}

#[test]
fn a_next_line_ignore_waives_the_element_below_it() {
    let html = "<!doctype html>\n<html><head><style>.k{color:#777;background:#888}</style></head>\n<body>\n\
                <!-- impeccable-disable-next-line low-contrast -->\n\
                <p class=\"k\">Waived</p>\n</body></html>\n";
    assert_eq!(lines(html), []);
}

#[test]
fn a_tag_after_a_wrapped_start_tag_does_not_take_its_line() {
    let html = "<!doctype html>\n<html><head><style>.k{color:#777;background:#888}</style></head>\n<body>\n\
                <p\n  class=\"k\"\n>Faint</p><!-- <p> --><b>x</b>\n\
                <!-- <p class=\"k\"> -->\n<p class=\"k\">Again</p>\n</body></html>\n";
    assert_eq!(lines(html), [("low-contrast".to_string(), 4.0)]);
    let found = detect_html_source(html, Path::new("page.html"), &DetectHtmlOptions::default());
    assert!(found[0].snippet.ends_with("(and 1 more)"), "{}", found[0].snippet);
}

#[test]
fn a_quoted_angle_bracket_does_not_close_a_wrapped_tag() {
    let html = "<!doctype html>\n<html><head><style>.k{color:#777;background:#888}</style></head>\n<body>\n\
                <p\n  class=\"k\"\n  title=\"a > b\"\n>Faint</p>\n</body></html>\n";
    assert_eq!(lines(html), [("low-contrast".to_string(), 4.0)]);
}

#[test]
fn a_tag_name_inside_an_attribute_is_not_the_tag() {
    let html = "<!doctype html>\n<html><head><style>.k{color:#777;background:#888}</style></head>\n<body>\n\
                <div title=\"see <p\n> for details\"><p class=\"k\">Faint</p></div>\n</body></html>\n";
    assert_eq!(lines(html), [("low-contrast".to_string(), 5.0)]);
}
