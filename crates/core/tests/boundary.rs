//! The boundary itself, exercised end to end.
//!
//! `ffi.rs`'s unit tests pin the ABI number and the function table. These pin
//! the two callback paths, which nothing else in the open workspace reaches:
//! a `&dyn StyleMap` argument routed through the host vtable, and a whole
//! `&dyn Dom` walked by the closed driver one method at a time.

use impeccable_core::browser::fake_dom::FakeDom;
use impeccable_core::browser::{driver, page_checks, BrowserConfig, Dom, ElId};
use impeccable_core::checks::{measures, text_rules};
use std::collections::HashMap;

fn style(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

#[test]
fn style_map_callback_round_trips() {
    // positioned_style_implies_escape reads eleven inset properties off the
    // style map; each read is one host call.
    assert!(measures::positioned_style_implies_escape(&style(&[
        ("position", "absolute"),
        ("left", "-40px"),
    ])));
    assert!(measures::positioned_style_implies_escape(&style(&[(
        "inset", "0 0 0 100%"
    )])));
    assert!(!measures::positioned_style_implies_escape(&style(&[
        ("top", "0px"),
        ("left", "8px"),
    ])));
}

#[test]
fn optional_style_map_absent_and_present() {
    assert!(!measures::is_opaque_decorated_box(None));
    assert!(measures::is_opaque_decorated_box(Some(&style(&[(
        "backgroundColor",
        "rgb(255, 255, 255)"
    )]))));
    assert!(!measures::is_opaque_decorated_box(Some(&style(&[(
        "backgroundColor",
        "rgba(0, 0, 0, 0.2)"
    )]))));

    assert!(!text_rules::is_repeated_text_container(None));
    assert!(text_rules::is_repeated_text_container(Some(&style(&[
        ("boxShadow", "rgba(0, 0, 0, 0.1) 0px 2px 4px 0px"),
        ("borderRadius", "8px"),
        ("backgroundColor", "rgb(255, 255, 255)"),
    ]))));
}

/// A page whose text is mostly hidden at rest.
fn hidden_text_page() -> FakeDom {
    let mut d = FakeDom::new();
    let (html, body) = d.with_page();
    for el in [html, body] {
        d.set_styles(
            el,
            &[
                ("display", "block"),
                ("opacity", "1"),
                ("visibility", "visible"),
            ],
        );
    }
    let visible = d.add(Some(body), "p");
    d.add_text(visible, &"v".repeat(100));
    d.set_styles(
        visible,
        &[
            ("display", "block"),
            ("opacity", "1"),
            ("visibility", "visible"),
        ],
    );
    let hidden = d.add(Some(body), "p");
    d.add_text(hidden, &"h".repeat(300));
    d.set_styles(
        hidden,
        &[
            ("display", "block"),
            ("opacity", "0"),
            ("visibility", "visible"),
        ],
    );
    let n = d.els.len() as ElId;
    for id in 1..n {
        if id != body && d.contains(body, id) {
            d.add_selector(id, "body *");
        }
    }
    d
}

#[test]
fn dom_callback_walks_a_whole_page() {
    let d = hidden_text_page();
    let m = page_checks::measure_hidden_text_dom(&d);
    assert_eq!(m.total_chars, 400.0);
    assert_eq!(m.hidden_chars, 300.0);
    assert_eq!(m.hidden_samples.len(), 1);
    assert!(m.hidden_samples[0].starts_with("hhh"));

    // The same walk, through the driver: hundreds of host calls, then a
    // findings tree that serializes back as JSON.
    let out = driver::collect_browser_findings(&d, &BrowserConfig::default());
    let json = driver::serialize_findings(&d, &out.groups);
    assert!(json.is_array(), "{json}");
}

#[test]
fn browser_config_json_fields_survive() {
    let mut d = FakeDom::new();
    d.with_page();
    let config = BrowserConfig {
        extension_mode: true,
        skip_scan: true,
        ..Default::default()
    };
    // skip_scan waives the page wholesale, so every stage answers empty:
    // proof the config crossed intact.
    let out = driver::collect_browser_findings(&d, &config);
    assert!(out.groups.is_empty());
    assert!(out.page_level.is_empty());
}

/// The visual-contrast subsystem is the widest set of shapes on the boundary:
/// tuples of `f64`, plans that mix a `serde_json::Value` with postcard fields,
/// and three `Result`s whose error half is a `Value`. Nothing else in this
/// workspace exercises it offline (it drives the in-page bundle), so this
/// walks every wire shape once and requires each to decode.
#[test]
fn every_visual_wire_shape_round_trips() {
    use impeccable_core::browser::visual as v;
    use impeccable_core::color::Rgba;
    use serde_json::json;

    let plan = v::raster_plan(1200.0, 900.0);
    assert!(plan.width > 0.0 && plan.scale_x > 0.0);
    let (px, py) = v::raster_pixel(&plan, 10.0, 20.0);
    assert!(px.is_finite() && py.is_finite());

    let sample = v::pixel_sample(10.0, 20.0, 30.0, 255.0);
    assert_eq!(sample["status"], json!("sampled"));
    assert!(v::sample_is_opaque(&sample));
    assert!(v::alpha_composite(sample.clone(), &sample).is_object());
    assert!(v::img_finish(sample.clone()).is_object());
    assert!(v::css_url_finish(sample.clone()).is_object());

    assert!(!v::raster_error_reason("SecurityError: tainted").is_empty());
    assert!(v::raster_failure_sample("tainted").is_object());
    assert!(v::raster_no_context_sample().is_object());
    assert!(v::css_url_no_image().is_object());
    assert!(v::unresolved_from_reasons(&["blend mode".to_string()]).is_object());
    assert!(!v::needs_scroll_retry(&json!({ "status": "sampled" })));

    let painted = v::PaintedRect {
        left: 0.0,
        top: 0.0,
        width: 100.0,
        height: 50.0,
        intrinsic_width: 200.0,
        intrinsic_height: 100.0,
    };
    assert!(v::img_loaded_source_point(&painted, 200.0, 100.0, 10.0, 10.0).is_some());

    let text_color = Rgba::new(0.0, 0.0, 0.0, 1.0);
    let candidate = json!({ "selector": "p", "reasons": [], "textColor": { "r": 0, "g": 0, "b": 0 } });
    let verdict = v::finish_analysis(&candidate, &text_color, &[sample], 1);
    assert!(verdict.is_object());

    // The dom-taking half. A FakeDom with no hit-test points answers "no
    // stack", which is a perfectly good decode.
    let d = hidden_text_page();
    let el = d.query_one(None, "body *").unwrap().unwrap();
    let _ = v::collect_visual_contrast_reasons(&d, el);
    let _ = v::collect_visual_contrast_candidates(&d, &json!({}));
    let _ = v::stack_nodes(&d, el, 1.0, 1.0, 0.0);
    let _ = v::img_source_point(&d, el, 100.0, 50.0, 1.0, 1.0);
    let _ = v::raster_source_point(&d, el, 100.0, 50.0, 1.0, 1.0);
    let _ = v::raster_finish(&d, el, v::pixel_sample(1.0, 2.0, 3.0, 255.0));
    let _ = v::css_plan(&d, el, Some(&text_color));
    let _ = v::css_url_source_point(&d, el, 100.0, 50.0, "cover", "50% 50%", 1.0, 1.0);
    let _ = v::prepare_analysis(&d, &candidate);
}

/// The shims with no caller in this workspace: the oracle and the vector
/// replay never reach them, so nothing else would notice their wire shape
/// drifting. With this test every id in `fn_id::TABLE_ENTRIES` is crossed at
/// least once by `cargo test --workspace`.
#[test]
fn shims_without_an_open_caller_still_cross() {
    use impeccable_core::browser::element_checks;
    use impeccable_core::checks::{css_scan, html_patterns, rules};
    use impeccable_core::color::Rgba;

    assert!(rules::is_accent_color("rgb(99, 102, 241)"));
    assert!(!rules::is_accent_color("rgb(17, 17, 17)"));
    assert!(rules::resolve_serif(Some("Georgia, serif")).is_serif);
    assert!(!rules::resolve_serif(Some("Inter, sans-serif")).is_serif);

    assert!(text_rules::check_em_dash_overuse(Some("plain text")).is_empty());

    // Reached in production only behind a gate the oracle corpus does not
    // trip (a hover style, a page-level CSS analyzer run, the browser crate).
    assert!(rules::check_hover_contrast(&rules::HoverContrastOpts::default()).is_empty());
    let hidden = measures::check_content_hidden_at_rest(&measures::ContentHiddenInput {
        total_chars: 1000.0,
        hidden_chars: 800.0,
        hidden_samples: vec!["lorem ipsum".to_string()],
    });
    assert_eq!(hidden.len(), 1);
    assert_eq!(hidden[0].id, "content-hidden-at-rest");
    assert!(css_scan::scan_css_text_for_glow("").is_empty());
    assert!(css_scan::scan_css_text_for_radial_halo("").is_empty());
    assert!(css_scan::scan_css_text_for_organic_clip_path("").is_empty());
    assert!(css_scan::scan_css_text_for_marquee("", None).is_empty());

    let props = css_scan::collect_css_custom_props(":root { --bg: #0b0b0f; }");
    let _ = css_scan::css_text_has_dark_root_bg(":root { background: var(--bg); }", &props);
    assert!(css_scan::scan_css_text_for_inset_stripe("").is_empty());
    assert!(css_scan::scan_css_text_for_buried_raster("").is_empty());
    assert!(css_scan::scan_css_text_for_pulsing_dot("", None).is_empty());
    assert!(css_scan::is_round_dot_radius("50%", 8.0, 8.0));
    assert!(!css_scan::is_round_dot_radius("2px", 8.0, 8.0));

    assert!(html_patterns::scan_html_for_shape_assembled_illustration("<p>hi</p>").is_empty());
    let corpora = html_patterns::build_html_pattern_corpora("<div class=\"card\">hi</div>");
    let _ = html_patterns::check_html_patterns("<div class=\"card\">hi</div>", Some(&corpora));

    let d = hidden_text_page();
    let el = d.query_one(None, "body *").unwrap().unwrap();
    assert!(!driver::scoped_ignore_active(&d, el, "ai-slop-glow"));
    let _ = element_checks::is_rendered_for_browser_rule(&d, el);

    // Rgba crosses in both directions (its JSON shape and its wire shape
    // differ; see `impeccable_foundation::color::Rgba`).
    assert!(measures::is_cream_color(Some(&Rgba::new(253.0, 250.0, 240.0, 1.0))));
    assert!(!measures::is_cream_color(Some(&Rgba::new(0.0, 0.0, 0.0, 1.0))));
    assert!(!measures::is_cream_color(None));
}
