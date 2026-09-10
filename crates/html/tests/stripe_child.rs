use impeccable_html::{detect_html_source, DetectHtmlOptions};
use std::path::Path;

fn side_tab_snippets(html: &str) -> Vec<String> {
    detect_html_source(
        html,
        Path::new("/app/stripe.html"),
        &DetectHtmlOptions::default(),
    )
    .into_iter()
    .filter(|f| f.antipattern == "side-tab")
    .map(|f| f.snippet)
    .collect()
}

#[test]
fn flex_row_first_child_flags() {
    let html = r#"<!DOCTYPE html><html><head><style>
.card { display: flex; flex-direction: row; width: 320px; height: 100px; }
.stripe { width: 4px; background: #f59e0b; }
.body { flex: 1; }
</style></head><body>
<div class="card"><div class="stripe"></div><div class="body">Content</div></div>
</body></html>"#;
    let hits = side_tab_snippets(html);
    assert_eq!(hits.len(), 1);
    assert!(hits[0].contains("stripe child (left)"));
}

#[test]
fn absolute_left_inset_flags() {
    let html = r#"<!DOCTYPE html><html><head><style>
.card { position: relative; width: 320px; height: 100px; }
.stripe { position: absolute; inset: 0 auto 0 0; width: 4px; background: #3b82f6; }
</style></head><body>
<div class="card"><div class="stripe"></div></div>
</body></html>"#;
    let hits = side_tab_snippets(html);
    assert_eq!(hits.len(), 1);
    assert!(hits[0].contains("stripe child (left)"));
}

#[test]
fn absolute_top_bottom_flags() {
    let html = r#"<!DOCTYPE html><html><head><style>
.card { position: relative; width: 320px; height: 100px; }
.stripe { position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: #3b82f6; }
</style></head><body>
<div class="card"><div class="stripe"></div></div>
</body></html>"#;
    let hits = side_tab_snippets(html);
    assert_eq!(hits.len(), 1);
    assert!(hits[0].contains("stripe child (left)"));
}

#[test]
fn flex_column_does_not_flag() {
    let html = r#"<!DOCTYPE html><html><head><style>
.card { display: flex; flex-direction: column; width: 320px; height: 100px; }
.stripe { width: 4px; background: #f59e0b; }
</style></head><body>
<div class="card"><div class="stripe"></div><div>Body</div></div>
</body></html>"#;
    assert!(side_tab_snippets(html).is_empty());
}

#[test]
fn align_items_center_does_not_flag() {
    let html = r#"<!DOCTYPE html><html><head><style>
.card { display: flex; align-items: center; width: 320px; height: 100px; }
.stripe { width: 4px; background: #f59e0b; }
</style></head><body>
<div class="card"><div class="stripe"></div><div>Body</div></div>
</body></html>"#;
    assert!(side_tab_snippets(html).is_empty());
}

#[test]
fn align_self_flex_start_does_not_flag() {
    let html = r#"<!DOCTYPE html><html><head><style>
.card { display: flex; width: 320px; height: 100px; }
.stripe { width: 4px; align-self: flex-start; background: #f59e0b; }
</style></head><body>
<div class="card"><div class="stripe"></div><div>Body</div></div>
</body></html>"#;
    assert!(side_tab_snippets(html).is_empty());
}

#[test]
fn neutral_and_contentful_and_wide_do_not_flag() {
    let neutral = r#"<!DOCTYPE html><html><head><style>
.card { display: flex; width: 320px; height: 100px; }
.stripe { width: 4px; background: #e5e5e5; }
</style></head><body>
<div class="card"><div class="stripe"></div><div>Body</div></div>
</body></html>"#;
    assert!(side_tab_snippets(neutral).is_empty());

    let text = r#"<!DOCTYPE html><html><head><style>
.card { display: flex; width: 320px; height: 100px; }
.stripe { width: 4px; background: #f59e0b; }
</style></head><body>
<div class="card"><div class="stripe">!</div><div>Body</div></div>
</body></html>"#;
    assert!(side_tab_snippets(text).is_empty());

    let wide = r#"<!DOCTYPE html><html><head><style>
.card { display: flex; width: 320px; height: 100px; }
.stripe { width: 40px; background: #f59e0b; }
</style></head><body>
<div class="card"><div class="stripe"></div><div>Body</div></div>
</body></html>"#;
    assert!(side_tab_snippets(wide).is_empty());
}

#[test]
fn rem_width_flags() {
    let html = r#"<!DOCTYPE html><html><head><style>
.card { display: flex; width: 320px; height: 100px; }
.stripe { width: 0.25rem; background: #f59e0b; }
</style></head><body>
<div class="card"><div class="stripe"></div><div>Body</div></div>
</body></html>"#;
    let hits = side_tab_snippets(html);
    assert_eq!(hits.len(), 1);
    assert!(hits[0].contains("stripe child (left)"));
}

#[test]
fn height_full_with_align_center_flags() {
    let html = r#"<!DOCTYPE html><html><head><style>
.card { display: flex; align-items: center; width: 320px; height: 100px; }
.stripe { width: 4px; height: 100%; background: #f59e0b; }
</style></head><body>
<div class="card"><div class="stripe"></div><div>Body</div></div>
</body></html>"#;
    let hits = side_tab_snippets(html);
    assert_eq!(hits.len(), 1);
    assert!(hits[0].contains("stripe child (left)"));
}

#[test]
fn inset_after_left_longhand_flags() {
    let html = r#"<!DOCTYPE html><html><head><style>
.card { position: relative; width: 320px; height: 100px; }
.stripe { position: absolute; left: 10px; inset: 0 auto 0 0; width: 4px; background: #3b82f6; }
</style></head><body>
<div class="card"><div class="stripe"></div></div>
</body></html>"#;
    let hits = side_tab_snippets(html);
    assert_eq!(hits.len(), 1);
    assert!(hits[0].contains("stripe child (left)"));
}

#[test]
fn row_reverse_first_child_is_right() {
    let html = r#"<!DOCTYPE html><html><head><style>
.card { display: flex; flex-direction: row-reverse; width: 320px; height: 100px; }
.stripe { width: 4px; background: #f59e0b; }
.body { flex: 1; }
</style></head><body>
<div class="card"><div class="stripe"></div><div class="body">Content</div></div>
</body></html>"#;
    let hits = side_tab_snippets(html);
    assert_eq!(hits.len(), 1);
    assert!(hits[0].contains("stripe child (right)"));
}
