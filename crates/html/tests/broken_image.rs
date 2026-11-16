use impeccable_html::{detect_html_source, DetectHtmlOptions};
use std::path::Path;

fn count(body: &str) -> usize {
    detect_html_source(body, Path::new("/tmp/broken-image.html"), &DetectHtmlOptions::default())
        .iter().filter(|f| f.antipattern == "broken-image").count()
}

#[test]
fn srcset_is_an_image_source() {
    assert_eq!(count("<img srcset=\"photo.png 1x, photo@2x.png 2x\" alt=\"Example\">"), 0);
    assert_eq!(count("<img srcset=\"photo.png 400w, photo@2x.png 800w\" sizes=\"100vw\" alt=\"Example\">"), 0);
    assert_eq!(count("<img src=\"\" srcset=\"/a.png 1x\" alt=\"\">"), 0);
}

#[test]
fn an_image_without_a_source_is_still_reported() {
    assert_eq!(count("<img srcset=\"\" alt=\"\">"), 1);
    assert_eq!(count("<img alt=\"\">"), 1);
    assert_eq!(count("<img src=\"#\" alt=\"\">"), 1);
}

#[test]
fn framework_bindings_are_image_sources() {
    for line in [
        r#"<img ngSrc="/assets/hero.png" width="640" height="360" alt="Hero banner" priority />"#,
        r#"<img [ngSrc]="user.avatarUrl" width="48" height="48" [alt]="user.name" />"#,
        r#"<div class="cover"><img [ngSrc]="cover" fill alt="Cover" /></div>"#,
        r#"<img [src]="logoUrl" [alt]="companyName" width="120" height="40" />"#,
        r#"<img [attr.src]="iconUrl" [attr.alt]="iconLabel" width="16" height="16" />"#,
        r#"<img src="/assets/plain.png" alt="Plain" width="10" height="10" />"#,
        r#"<img [srcset]="set" alt="">"#,
        r#"<img [attr.srcset]="set" alt="">"#,
        r#"<img bind-src="url" alt="">"#,
        r#"<img :src="url" alt="">"#,
        r#"<img v-bind:src="url" alt="">"#,
        r#"<img data-src="/lazy.png" alt="">"#,
    ] {
        assert_eq!(count(line), 0, "{line}");
    }
}

#[test]
fn empty_or_unrelated_bindings_are_still_reported() {
    for line in [
        r#"<img ngSrc="" alt="">"#,
        r#"<img [src]="" alt="">"#,
        r#"<img [alt]="x">"#,
        r#"<img [attr.alt]="x">"#,
        r#"<img [style.src]="x" alt="">"#,
        r#"<img attr.src="x" alt="">"#,
        // NgOptimizedImage only activates on `ngSrc`; alone this is inert.
        r#"<img ngSrcset="a.png 1x" alt="">"#,
    ] {
        assert_eq!(count(line), 1, "{line}");
    }
}
