//! A label set as the h1's eyebrow is a kicker however it is dressed: in a
//! small-caps face ("IM Fell English SC") rather than `font-variant`, with a
//! middle dot in it, inside the `<article>` that holds the page's hero, over
//! a fluid `clamp()` heading. A byline above the h1 stays meta, and a
//! Simplified Chinese face named "… SC" sets no small caps.

use impeccable_html::{detect_html_source, DetectHtmlOptions};
use std::path::Path;

fn kickers(label: &str, face: &str) -> Vec<String> {
    let html = format!(
        r#"<!doctype html><html><head><style>
:root {{ --caps: {face}, serif; }}
.maker {{ font-family: var(--caps); letter-spacing: .14em; font-size: .9rem; }}
h1 {{ font-family: Georgia, serif; font-size: clamp(2.3rem, 4.5vw, 4.3rem); }}
@media (max-width: 720px) {{ h1 {{ font-size: 2.15rem; }} }}
</style></head><body><main><article class="face front"><div>
<p class="maker">{label}</p>
<h1>Grow the whole year, not just the flower.</h1>
</div></article></main></body></html>"#
    );
    detect_html_source(&html, Path::new("hero.html"), &DetectHtmlOptions::default())
        .into_iter()
        .filter(|f| f.antipattern == "kicker-above-heading")
        .map(|f| f.snippet)
        .collect()
}

#[test]
fn a_small_caps_eyebrow_over_the_hero_h1_is_a_kicker() {
    let hits = kickers("Bloom seeds · Packet 1 of 4", "\"IM Fell English SC\"");
    assert_eq!(hits.len(), 1, "{hits:?}");
    assert!(hits[0].contains("Bloom seeds"), "{hits:?}");
}

#[test]
fn a_byline_and_a_chinese_face_are_not_kickers() {
    assert!(kickers("Essay · 6 min read", "\"IM Fell English SC\"").is_empty());
    assert!(kickers("Bloom seeds · Packet 1 of 4", "\"Noto Sans SC\"").is_empty());
}
