//! The sampled-contrast path end to end (#560): small pages scanned against
//! images written to a temp directory. Each case pins one way the sampler
//! must keep the skip, or one ground it must read, and would fail against
//! the first version of the path.

use impeccable_html::{detect_html_source, DetectHtmlOptions};
use std::path::PathBuf;

const LIGHT: [u8; 4] = [243, 239, 230, 255];
const DARK: [u8; 4] = [26, 24, 22, 255];

struct Site(PathBuf);

impl Site {
    fn new(name: &str) -> Site {
        let dir = std::env::temp_dir().join(format!(
            "impeccable-sampled-{}-{}",
            name,
            std::process::id()
        ));
        std::fs::create_dir_all(dir.join("css")).unwrap();
        let site = Site(dir);
        site.png("light.png", 320, 200, LIGHT);
        site.png("dark.png", 320, 200, DARK);
        site.png("cutout.png", 320, 200, [243, 239, 230, 64]);
        site.png("icon.png", 24, 24, LIGHT);
        site.png("seal.png", 1200, 1200, LIGHT);
        site
    }

    fn png(&self, rel: &str, width: u32, height: u32, rgba: [u8; 4]) {
        image::RgbaImage::from_pixel(width, height, image::Rgba(rgba))
            .save(self.0.join(rel))
            .unwrap();
    }

    fn write(&self, rel: &str, text: &str) {
        std::fs::write(self.0.join(rel), text).unwrap();
    }

    /// Every finding of `rule` for a page with this `<style>` and body.
    fn findings(&self, rule: &str, head: &str, body: &str) -> Vec<String> {
        let html = format!("<!DOCTYPE html><html><head>{head}</head><body>{body}</body></html>");
        detect_html_source(
            &html,
            &self.0.join("page.html"),
            &DetectHtmlOptions::default(),
        )
        .into_iter()
        .filter(|f| f.antipattern == rule)
        .map(|f| f.snippet)
        .collect()
    }

    fn contrast(&self, css: &str, body: &str) -> Vec<String> {
        self.findings("low-contrast", &format!("<style>{css}</style>"), body)
    }
}

impl Drop for Site {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).ok();
    }
}

fn sampled_on(image: &str, findings: &[String]) -> bool {
    findings.len() == 1
        && findings[0].starts_with("sampled (coarse) ")
        && findings[0].contains(&format!(" on {image};"))
}

const DARK_SECTION: &str = "section { background: #17150f; padding: 24px; }";

#[test]
fn the_baseline_reads_the_image() {
    let site = Site::new("baseline");
    let css = ".hero { background: url(light.png); } p { color: #fdfdfd; }";
    let found = site.contrast(
        css,
        "<div class=hero><p>White copy on a light image</p></div>",
    );
    assert!(sampled_on("light.png", &found), "{found:?}");
}

#[test]
fn text_that_is_hidden_on_purpose_is_not_measured() {
    let site = Site::new("alpha");
    // Image replacement: the text is transparent and the logo is the label.
    for color in ["rgba(0, 0, 0, 0)", "#0000", "rgba(253, 253, 253, 0.05)"] {
        let css = format!(".brand {{ color: {color}; background: url(light.png); }}");
        let found = site.contrast(
            &css,
            "<a class=brand href=/>Acme</a><p class=brand>Acme</p>",
        );
        assert!(found.is_empty(), "{color}: {found:?}");
    }
}

#[test]
fn a_label_replaced_by_its_image_is_not_measured() {
    let site = Site::new("replaced");
    // Ink on the dark image would be unreadable if it were shown. Every
    // case uses a tag the color rule measures (`span` and `a` it never
    // does), so the skip under test is the one that decides.
    let banner = ".banner { background: url(dark.png); color: #262421; }";
    for (hide, body) in [
        // The classic replacements: the text is thrown out of its box.
        (
            ".banner { text-indent: -9999px; overflow: hidden; }",
            "<h1 class=banner>Acme Tools</h1>",
        ),
        (
            ".banner { text-indent: 100%; white-space: nowrap; overflow: hidden; }",
            "<h1 class=banner>Acme Tools</h1>",
        ),
        // text-indent inherits: the label may sit in a child.
        (
            ".banner { text-indent: -999em; }",
            "<div class=banner><p>Acme Tools</p></div>",
        ),
        (
            ".banner { text-indent: -9999px; }",
            "<h1 class=banner><em>Acme Tools</em></h1>",
        ),
        (".banner { font-size: 0; }", "<h1 class=banner>Acme Tools</h1>"),
        // A visually-hidden heading inside an image-backed box.
        ("", "<div class=banner><h2 class=sr-only>Acme Tools</h2></div>"),
        (
            ".label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }",
            "<div class=banner><h2 class=label>Acme Tools</h2></div>",
        ),
    ] {
        let found = site.contrast(&format!("{banner} {hide}"), body);
        assert!(found.is_empty(), "{hide} {body}: {found:?}");
    }
    for (shown, body) in [
        ("", "<h1 class=banner>Acme Tools</h1>"),
        ("", "<h1 class=banner><em>Acme Tools</em></h1>"),
        ("", "<div class=banner><h2>Acme Tools</h2></div>"),
        // An ordinary indent is still text on the image.
        (
            ".banner { text-indent: 2em; }",
            "<h1 class=banner>Acme Tools</h1>",
        ),
    ] {
        let found = site.contrast(&format!("{banner} {shown}"), body);
        assert!(sampled_on("dark.png", &found), "{shown} {body}: {found:?}");
    }
    // Such an indent keeps the skip even where a descendant resets it, or
    // where a `100%` indent could wrap back into view: telling takes box
    // types and line layout the engine does not have, and the sampler stays
    // silent when it cannot know.
    for (limit, body) in [
        (
            ".banner { text-indent: -9999px; } .banner p { text-indent: 0; }",
            "<div class=banner><p>Acme Tools</p></div>",
        ),
        (
            ".banner { text-indent: 100%; overflow: hidden; }",
            "<h1 class=banner>Acme Tools</h1>",
        ),
    ] {
        let found = site.contrast(&format!("{banner} {limit}"), body);
        assert!(found.is_empty(), "{limit} {body}: {found:?}");
    }
}

#[test]
fn a_scrim_with_a_keyword_stop_keeps_the_skip() {
    let site = Site::new("scrim");
    let body = "<div class=hero><p>Copy over a scrim</p></div>";
    // Dark text on the bright end of a scrim spelled with `transparent`:
    // read as one 80% black stop, the whole image went dark and this fired.
    for (scrim, text) in [
        ("linear-gradient(rgba(0, 0, 0, 0.8), transparent)", "#111"),
        (
            "linear-gradient(to top, rgba(0, 0, 0, 0.75), transparent)",
            "#111",
        ),
        (
            "linear-gradient(rgba(0, 0, 0, 0.8), rgba(0, 0, 0, 0))",
            "#111",
        ),
        // The mirror case passed by accident, darkened everywhere.
        (
            "linear-gradient(transparent, rgba(0, 0, 0, 0.8))",
            "#fdfdfd",
        ),
        ("linear-gradient(black, transparent)", "#111"),
        (
            "radial-gradient(circle at top, transparent 20%, rgba(0, 0, 0, 0.8))",
            "#fdfdfd",
        ),
    ] {
        let css =
            format!(".hero {{ background: {scrim}, url(light.png); }} p {{ color: {text}; }}");
        let found = site.contrast(&css, body);
        assert!(found.is_empty(), "{scrim}: {found:?}");
    }
    // A uniform tint still composites: 30% black over the light image is
    // too weak for white copy, 70% is enough.
    let weak = ".hero { background: linear-gradient(rgba(0,0,0,.3), rgba(0,0,0,.3)), url(light.png); } p { color: #fdfdfd; }";
    assert!(sampled_on("light.png", &site.contrast(weak, body)));
    let strong = ".hero { background: linear-gradient(to right, rgba(0,0,0,.7) 0%, rgba(0,0,0,.7) 100%), url(light.png); } p { color: #fdfdfd; }";
    assert!(site.contrast(strong, body).is_empty());
}

#[test]
fn a_tint_on_a_wrapper_between_the_text_and_the_image_composites() {
    let site = Site::new("wrapper");
    // The analytic walk stops at the wrapper and has nothing to measure
    // against; the sampled walk goes through a uniform tint to the photo
    // behind it, whether the tint is a gradient or a translucent color.
    let page = |tint: &str| {
        site.contrast(
            &format!(
                ".hero {{ background: url(light.png); }} .tint {{ background: {tint}; }} \
                 p {{ color: #fdfdfd; }}"
            ),
            "<div class=hero><div class=tint><p>White copy on a tinted wrapper</p></div></div>",
        )
    };
    for weak in [
        "linear-gradient(rgba(0, 0, 0, 0.3), rgba(0, 0, 0, 0.3))",
        "rgba(0, 0, 0, 0.3)",
    ] {
        let found = page(weak);
        assert!(sampled_on("light.png", &found), "{weak}: {found:?}");
    }
    for strong in [
        "linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.7))",
        "rgba(0, 0, 0, 0.7)",
        // A wrapper scrim that varies keeps the skip, like one on the image.
        "linear-gradient(rgba(0, 0, 0, 0.3), transparent)",
    ] {
        let found = page(strong);
        assert!(found.is_empty(), "{strong}: {found:?}");
    }
}

#[test]
fn a_color_only_shorthand_clears_the_image() {
    let site = Site::new("reset");
    // `.card.plain` paints nothing of its own: its ground is the dark
    // section, where white copy reads fine.
    let css = format!(
        "{DARK_SECTION} .card {{ background: url(light.png); }} \
         .card.plain {{ background: transparent; color: #fdfdfd; }}"
    );
    let found = site.contrast(
        &css,
        "<section><div class='card plain'>Plain card</div></section>",
    );
    assert!(found.is_empty(), "{found:?}");
    // The image is still there for the card that kept it.
    let kept = format!("{DARK_SECTION} .card {{ background: url(light.png); color: #fdfdfd; }}");
    let found = site.contrast(&kept, "<section><div class=card>Paper card</div></section>");
    assert!(sampled_on("light.png", &found), "{found:?}");
}

#[test]
fn a_color_after_the_image_is_the_color_under_it() {
    let site = Site::new("color-after");
    // The light texture at 25% alpha over the declared #17150f is a dark
    // ground. Read without that color it composited over the white page
    // and the verdicts inverted.
    let body = "<div class=panel>Copy on the translucent texture</div>";
    // After the image in its layer, or as the final layer of the list.
    for background in ["url(cutout.png) #17150f", "url(cutout.png), #17150f"] {
        let css = |text: &str| format!(".panel {{ background: {background}; color: {text}; }}");
        let white = site.contrast(&css("#fdfdfd"), body);
        assert!(white.is_empty(), "{background}: {white:?}");
        let ink = site.contrast(&css("#262421"), body);
        assert!(sampled_on("cutout.png", &ink), "{background}: {ink:?}");
    }
}

#[test]
fn a_layer_that_does_not_fill_the_box_is_not_the_ground() {
    let site = Site::new("gate");
    let body = "<section><p class=x>White copy beside a small image</p></section>";
    for decl in [
        // A percentage fills an axis only at 100% and up.
        "url(icon.png) no-repeat left center / 5% auto",
        "url(light.png) repeat-y left / auto 100%",
        "url(light.png) no-repeat center / 50% 50%",
        // A length in any unit, not only px: a 1200px seal painted at 4rem.
        "url(seal.png) no-repeat right top / 4rem",
        "url(seal.png) no-repeat right top / 4em 4em",
        // What layout would have to resolve keeps the skip.
        "url(seal.png) no-repeat right top / 10vw",
        "url(seal.png) no-repeat right top / calc(2rem + 32px)",
        "url(seal.png) no-repeat right top / var(--missing)",
        "url(seal.png) no-repeat right top / contain",
    ] {
        let css = format!("{DARK_SECTION} .x {{ background: {decl}; color: #fdfdfd; }}");
        let found = site.contrast(&css, body);
        assert!(found.is_empty(), "{decl}: {found:?}");
    }
    // A custom property is resolved before the size is read, both ways.
    let seal = format!(
        "{DARK_SECTION} :root {{ --seal: 64px; --full: cover; }} \
         .x {{ background: url(seal.png) no-repeat right top / var(--seal); color: #fdfdfd; }}"
    );
    assert!(site.contrast(&seal, body).is_empty());
    let full = seal.replace("var(--seal)", "var(--full)");
    assert!(sampled_on("seal.png", &site.contrast(&full, body)));
    // Sizes that do fill, or that are large and known, are still read.
    for decl in [
        "url(light.png) no-repeat center / cover",
        "url(light.png) no-repeat center / 100% 100%",
        "url(light.png) no-repeat",
        "url(seal.png) no-repeat center / 20rem",
    ] {
        let css = format!("{DARK_SECTION} .x {{ background: {decl}; color: #fdfdfd; }}");
        let found = site.contrast(&css, body);
        assert_eq!(found.len(), 1, "{decl}: {found:?}");
    }
}

#[test]
fn an_escaped_url_ends_where_the_tokenizer_says() {
    let site = Site::new("escapes");
    site.png("a).png", 320, 200, LIGHT);
    site.png("b c.png", 320, 200, LIGHT);
    let body = "<div class=hero><p>White copy on an oddly named image</p></div>";
    // The generator re-emits these as `url(a\).png)` and `url(b\ c.png)`;
    // the scan used to close at the escaped paren.
    for (url, name) in [("\"a).png\"", "a).png"), ("'b c.png'", "b c.png")] {
        let css = format!(
            ".hero {{ background: url({url}) center / cover no-repeat; }} p {{ color: #fdfdfd; }}"
        );
        let found = site.contrast(&css, body);
        assert!(sampled_on(name, &found), "{url}: {found:?}");
    }
    // The same through a style attribute, where the value is not
    // regenerated and keeps its quotes.
    let inline = "<div style=\"background: url('a).png') no-repeat center / cover\"><p style=\"color: #fdfdfd\">Inline</p></div>";
    assert!(sampled_on("a).png", &site.contrast("", inline)));
}

#[test]
fn a_fallback_color_under_a_covering_image_is_not_the_ground() {
    let site = Site::new("fallback");
    let body = "<div class=hero><p>Copy on a photo with a fallback color</p></div>";
    let page = |decl: &str, text: &str| {
        site.contrast(
            &format!(".hero {{ background: {decl}; }} p {{ color: {text}; }}"),
            body,
        )
    };
    // The most common way to declare an image ground. White copy over the
    // light image used to pass against the #111 beneath it.
    assert!(sampled_on(
        "light.png",
        &page("#111 url(light.png) center / cover", "#fdfdfd")
    ));
    // And ink on the same image was flagged against that #111.
    assert!(page("#111 url(light.png) center / cover", "#262421").is_empty());
    assert!(page("#f4f1ea url(dark.png)", "#fdfdfd").is_empty());
    assert!(sampled_on(
        "dark.png",
        &page("#f4f1ea url(dark.png)", "#262421")
    ));
    // An image that does not provably fill the box leaves the color in
    // play, so the analytic answer stands exactly as before.
    let partial = page("#111 url(light.png) no-repeat right top", "#262421");
    assert_eq!(partial.len(), 1, "{partial:?}");
    assert!(partial[0].ends_with("on #111111"), "{partial:?}");
    assert!(page("#111 url(light.png) no-repeat right top", "#fdfdfd").is_empty());
    // An image the engine cannot read changes nothing either.
    let missing = page("#111 url(nope.png) center / cover", "#262421");
    assert!(
        missing.len() == 1 && missing[0].ends_with("on #111111"),
        "{missing:?}"
    );
}

#[test]
fn a_none_layer_is_skipped_and_an_unknown_one_stops() {
    let site = Site::new("layers");
    let body = "<div class=hero><p>White copy on a layered background</p></div>";
    let css = ".hero { background-image: none, url(light.png); } p { color: #fdfdfd; }";
    assert!(sampled_on("light.png", &site.contrast(css, body)));
    // A custom function is not the url token and is not read as an image.
    let custom = ".hero { background-image: myurl(light.png); } p { color: #fdfdfd; }";
    assert!(site.contrast(custom, body).is_empty());
    // A wrapper that paints an image function the engine does not read is
    // not read through to the image behind it.
    for paint in ["paint(dots)", "paint(var(--pattern))"] {
        let wrapped = format!(
            ".hero {{ background: url(light.png); }} .mid {{ background: {paint}; }} \
             p {{ color: #fdfdfd; }}"
        );
        let found = site.contrast(
            &wrapped,
            "<div class=hero><div class=mid><p>White copy behind a painted wrapper</p></div></div>",
        );
        assert!(found.is_empty(), "{paint}: {found:?}");
    }
    // A `display: contents` wrapper paints no box: its image is not the
    // ground, and its color does not hide the image behind it.
    let body = "<div class=hero><div class=wrap><p>White copy under a wrapper that paints no box</p></div></div>";
    let unpainted = ".hero { background: #111; } .wrap { display: contents; background: url(light.png); } p { color: #fdfdfd; }";
    let found = site.contrast(unpainted, body);
    assert!(found.is_empty(), "{found:?}");
    let behind = ".hero { background: url(light.png); } .wrap { display: contents; background: #111; } p { color: #fdfdfd; }";
    assert!(sampled_on("light.png", &site.contrast(behind, body)));
    let body = "<div class=hero><p>White copy on a layered background</p></div>";
    // Nor is a url that is another image function's argument: which
    // candidate paints, or what the blend looks like, is not known here.
    for image in [
        "image-set(url(light.png) 1x, url(dark.png) 2x)",
        "cross-fade(url(light.png), url(dark.png), 50%)",
    ] {
        let css = format!(".hero {{ background-image: {image}; }} p {{ color: #fdfdfd; }}");
        let found = site.contrast(&css, body);
        assert!(found.is_empty(), "{image}: {found:?}");
    }
}

#[test]
fn a_foreign_sheet_is_read_as_authored_and_resolved_per_rule() {
    let site = Site::new("sheet");
    site.png("css/hero.png", 320, 200, LIGHT);
    // A different image with the same name beside the page: the sheet's
    // url must not resolve to it.
    site.png("hero.png", 320, 200, DARK);
    site.write(
        "css/site.css",
        "/* a stray url( in a comment */\n\
         .hero { background: url(hero.png); }\n\
         .buried { background-image: linear-gradient(rgba(240,237,226,0.96), rgba(240,237,226,0.96)), url(hero.png); }\n",
    );
    let head = "<link rel=stylesheet href=css/site.css><style>p { color: #fdfdfd; }</style>";
    let body = "<div class=hero><p>White copy on the sheet's image</p></div><section class=buried>Wash</section>";
    let found = site.findings("low-contrast", head, body);
    assert!(sampled_on("hero.png", &found), "{found:?}");
    // The pattern checks see the sheet's text as written: the snippet names
    // the url the author wrote, the same one a scan of the sheet reports.
    let buried = site.findings("buried-raster", head, body);
    assert_eq!(buried.len(), 1, "{buried:?}");
    assert!(buried[0].contains("url(hero.png)"), "{buried:?}");
    assert!(!buried[0].contains("css/hero.png"), "{buried:?}");
}

#[test]
fn a_url_in_a_custom_property_follows_the_sheet_that_declares_it() {
    let site = Site::new("sheet-var");
    site.png("css/hero.png", 320, 200, LIGHT);
    site.png("hero.png", 320, 200, DARK);
    site.write(
        "css/tokens.css",
        ":root { --hero: url(\"hero.png\"); }\n.hero { background-image: var(--hero); }\n",
    );
    let head = "<link rel=stylesheet href=css/tokens.css><style>p { color: #fdfdfd; }</style>";
    let found = site.findings(
        "low-contrast",
        head,
        "<div class=hero><p>White copy on the token's image</p></div>",
    );
    assert!(sampled_on("hero.png", &found), "{found:?}");
}

#[test]
fn every_text_descendant_of_a_data_uri_ground_gets_a_verdict() {
    use base64::Engine;
    let site = Site::new("data-uri");
    let bytes = std::fs::read(site.0.join("light.png")).unwrap();
    let uri = format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    );
    let css = format!(".hero {{ background: url({uri}); }} p {{ color: #fdfdfd; }}");
    let body = format!("<div class=hero>{}</div>", "<p>White copy</p>".repeat(40));
    let found = site.contrast(&css, &body);
    assert_eq!(found.len(), 40);
    assert!(found.iter().all(|s| s.contains(" on data:image/png;")));
}

#[test]
fn the_page_dir_is_the_base_for_everything_inline() {
    let site = Site::new("base");
    site.png("css/only-here.png", 320, 200, LIGHT);
    // A `<style>` block is the page's own: its urls are page-relative, so a
    // file that exists only beside a stylesheet is not found.
    let css = ".hero { background: url(only-here.png); } p { color: #fdfdfd; }";
    let found = site.contrast(css, "<div class=hero><p>White copy</p></div>");
    assert!(found.is_empty(), "{found:?}");
}
