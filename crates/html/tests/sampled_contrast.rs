//! The sampled-contrast path end to end (#560): small pages scanned against
//! images written to a temp directory. Each case pins one way the sampler
//! must keep the skip, or one ground it must read, and would fail against
//! the first version of the path.

use base64::Engine;
use impeccable_html::image_sampling::ImageSamples;
use impeccable_html::{detect_html_source, DetectHtmlOptions};
use std::path::PathBuf;

const LIGHT: [u8; 4] = [243, 239, 230, 255];
const DARK: [u8; 4] = [26, 24, 22, 255];

/// A solid PNG, as bytes.
fn image_png(width: u32, height: u32, rgba: [u8; 4]) -> Vec<u8> {
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(width, height, image::Rgba(rgba)))
        .write_to(&mut out, image::ImageFormat::Png)
        .unwrap();
    out.into_inner()
}

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
        std::fs::write(self.0.join(rel), image_png(width, height, rgba)).unwrap();
    }

    fn write(&self, rel: &str, text: &str) {
        std::fs::write(self.0.join(rel), text).unwrap();
    }

    /// Every finding of `rule` for a page with this `<style>` and body,
    /// decoding as `detect` does, with the sample cache inside the site.
    fn findings(&self, rule: &str, head: &str, body: &str) -> Vec<String> {
        self.findings_as(rule, head, body, ImageSamples::Decode)
    }

    fn findings_as(&self, rule: &str, head: &str, body: &str, mode: ImageSamples) -> Vec<String> {
        let html = format!("<!DOCTYPE html><html><head>{head}</head><body>{body}</body></html>");
        let cache = self.0.join("sample-cache");
        detect_html_source(
            &html,
            &self.0.join("page.html"),
            &DetectHtmlOptions {
                image_samples: mode,
                sample_cache_dir: Some(&cache),
                ..Default::default()
            },
        )
        .into_iter()
        .filter(|f| f.antipattern == rule)
        .map(|f| f.snippet)
        .collect()
    }

    fn contrast(&self, css: &str, body: &str) -> Vec<String> {
        self.findings("low-contrast", &format!("<style>{css}</style>"), body)
    }

    fn contrast_as(&self, css: &str, body: &str, mode: ImageSamples) -> Vec<String> {
        self.findings_as("low-contrast", &format!("<style>{css}</style>"), body, mode)
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
fn paint_the_sampler_cannot_reproduce_keeps_the_skip() {
    let site = Site::new("unreadable-paint");
    let body = "<div class=hero><p>White copy on a blended photo</p></div>";
    // A dark colour multiplied under the light image paints dark: readable
    // white copy, which sampling the image alone would fail.
    let blended = ".hero { background: #111 url(light.png) center / cover; background-blend-mode: multiply; } \
                   p { color: #fdfdfd; }";
    assert!(site.contrast(blended, body).is_empty());
    let mixed = ".hero { background: url(light.png); } .mix { mix-blend-mode: multiply; } p { color: #fdfdfd; }";
    let found = site.contrast(
        mixed,
        "<div class=hero><div class=mix><p>White copy under a blended wrapper</p></div></div>",
    );
    assert!(found.is_empty(), "{found:?}");
    // A wash tints every sample only where it fills the box: a 20px patch
    // leaves ink readable outside it, a tiled one does not.
    let patch = ".hero { background: linear-gradient(rgba(0,0,0,.6), rgba(0,0,0,.6)) 0 0 / 20px 20px no-repeat, url(light.png); } \
                 p { color: #262421; }";
    let found = site.contrast(patch, body);
    assert!(found.is_empty(), "{found:?}");
    let tiled = patch.replace("no-repeat", "repeat");
    assert!(sampled_on("light.png", &site.contrast(&tiled, body)));
    // A `::before` stretched over the host with an opaque fill covers the
    // host's image for every descendant, not only for the host's own text.
    let covered = ".hero { position: relative; background: url(light.png); } \
                   .hero::before { content: \"\"; position: absolute; inset: 0; background: #111; } \
                   .hero p { position: relative; color: #fdfdfd; }";
    let found = site.contrast(
        covered,
        "<div class=hero><div class=copy><p>White copy above a dark pseudo surface</p></div></div>",
    );
    assert!(found.is_empty(), "{found:?}");
    // A translucent texture inside a covered fallback colour composites
    // over the covering image, unknown here, not over the colour.
    let nested = ".hero { background: #111 url(light.png) center / cover; } .inner { background: url(cutout.png); } \
                  p { color: #262421; }";
    let found = site.contrast(
        nested,
        "<div class=hero><div class=inner><p>Ink on a texture inside a covered colour</p></div></div>",
    );
    assert!(found.is_empty(), "{found:?}");
    // `background-repeat: initial` is `repeat`: the image fills the box and
    // is read over its fallback colour.
    let reset = ".hero { background: #111 url(light.png); background-repeat: initial; } p { color: #fdfdfd; }";
    assert!(sampled_on("light.png", &site.contrast(reset, body)));
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
    // Every copy is read, and the page reports the pair once, counting the
    // other thirty-nine (taste call r14-t2).
    assert_eq!(found.len(), 1, "{found:?}");
    assert!(found[0].contains(" on data:image/png;"), "{found:?}");
    assert!(found[0].ends_with(" (and 39 more)"), "{found:?}");
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

#[test]
fn the_hook_reads_only_what_detect_sampled() {
    let site = Site::new("hook-mode");
    let css = ".hero { background: url(light.png); } p { color: #fdfdfd; }";
    let body = "<div class=hero><p>White copy on a light image</p></div>";
    // With no cache entry the hook stays silent, as every image-backed
    // text was before this path existed.
    assert!(site.contrast_as(css, body, ImageSamples::CacheOnly).is_empty());
    // `detect` decodes, reports, and writes the entry; the hook then has
    // the verdict for free.
    assert!(sampled_on("light.png", &site.contrast(css, body)));
    assert!(sampled_on("light.png", &site.contrast_as(css, body, ImageSamples::CacheOnly)));
    // The hook never opens the image: its bytes are swapped for text under
    // the same size and modification time, and the hook still reports from
    // the entry, while an edit that changes the file misses it.
    let hero = site.0.join("light.png");
    let meta = std::fs::metadata(&hero).unwrap();
    std::fs::write(&hero, vec![b'x'; meta.len() as usize]).unwrap();
    std::fs::OpenOptions::new()
        .write(true)
        .open(&hero)
        .unwrap()
        .set_modified(meta.modified().unwrap())
        .unwrap();
    assert!(sampled_on("light.png", &site.contrast_as(css, body, ImageSamples::CacheOnly)));
    std::fs::write(&hero, b"not an image any more").unwrap();
    assert!(site.contrast_as(css, body, ImageSamples::CacheOnly).is_empty());
    // A second page sharing the hero takes the same entry: the cache is
    // keyed by the file, not the page.
    let other = "<div class=hero><p>Another page, same hero</p></div>";
    std::fs::write(&hero, image_png(320, 200, LIGHT)).unwrap();
    let found = site.contrast(css, other);
    assert!(sampled_on("light.png", &found), "{found:?}");
    assert!(sampled_on("light.png", &site.contrast_as(css, other, ImageSamples::CacheOnly)));
}

#[test]
fn a_page_with_several_photos_decodes_them_ahead() {
    let site = Site::new("decode-ahead");
    for name in ["a.png", "b.png", "c.png"] {
        site.png(name, 320, 200, LIGHT);
    }
    // Files are read inside the worker that decodes them; a data URI's
    // bytes come from the page itself. One of each kind here.
    let data = format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(image_png(320, 200, LIGHT))
    );
    let css = format!(".a {{ background: url(a.png); }} .b {{ background: url(b.png); }} .c {{ background: url(c.png); }} .d {{ background: url({data}); }} p {{ color: #fdfdfd; }}");
    let body = "<div class=a><p>One</p></div><div class=b><p>Two</p></div><div class=c><p>Three</p></div><div class=d><p>Four</p></div>";
    let found = site.contrast(&css, body);
    assert_eq!(found.len(), 4, "{found:?}");
    for name in ["a.png", "b.png", "c.png", "data:image/png"] {
        assert!(found.iter().any(|f| f.contains(&format!(" on {name};"))), "{found:?}");
    }
    // And the hook then reads all four from the cache.
    assert_eq!(site.contrast_as(&css, body, ImageSamples::CacheOnly).len(), 4);
}

#[test]
fn a_filter_between_the_text_and_the_image_stops_the_walk() {
    let site = Site::new("filters");
    let hero = ".hero { background: url(light.png); } p { color: #fdfdfd; }";
    for (rule, body, sampled) in [
        // A backdrop filter on the text or a wrapper reworks what shows
        // through behind the text; a filter on the image's box reworks the
        // image. Neither is in the samples, so the walk gives up.
        ("p { backdrop-filter: brightness(0.1); }", "<div class=hero><p>Copy</p></div>", false),
        ("p { -webkit-backdrop-filter: blur(4px) invert(1); }", "<div class=hero><p>Copy</p></div>", false),
        (".wrap { backdrop-filter: brightness(0.1); }", "<div class=hero><div class=wrap><p>Copy</p></div></div>", false),
        (".hero { filter: brightness(0.1); }", "<div class=hero><p>Copy</p></div>", false),
        (".hero { filter: var(--fx); }", "<div class=hero><p>Copy</p></div>", false),
        // A filter above the image element reworks image and text together.
        (".section { filter: contrast(0); }", "<div class=section><div class=hero><p>Copy</p></div></div>", false),
        (".section { filter: blur(1px); }", "<div class=section><div class=hero><p>Copy</p></div></div>", true),
        // A `display: contents` wrapper generates no box, so its filter
        // applies to nothing, above the image element as below it.
        (".section { display: contents; filter: contrast(0); }", "<div class=section><div class=hero><p>Copy</p></div></div>", true),
        (".wrap { display: contents; filter: contrast(0); }", "<div class=hero><div class=wrap><p>Copy</p></div></div>", true),
        // A blend on a boxed ancestor above the image reworks image and
        // text together with what is behind it; on a boxless one it does
        // not apply.
        (".section { mix-blend-mode: screen; }", "<div class=section><div class=hero><p>Copy</p></div></div>", false),
        (".section { display: contents; mix-blend-mode: screen; }", "<div class=section><div class=hero><p>Copy</p></div></div>", true),
        // A blur or a drop shadow leaves the region's mean color where it
        // is (a frosted panel is still the photo, averaged); `none` and the
        // initial value change nothing.
        ("p { backdrop-filter: blur(12px); }", "<div class=hero><p>Copy</p></div>", true),
        (".hero { filter: blur(2px) drop-shadow(0 1px 2px #000); }", "<div class=hero><p>Copy</p></div>", true),
        (".hero { filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3)); }", "<div class=hero><p>Copy</p></div>", true),
        ("p { backdrop-filter: blur(4px) drop-shadow(0 0 2px rgb(0 0 0 / 50%)); }", "<div class=hero><p>Copy</p></div>", true),
        ("p { backdrop-filter: none; } .hero { filter: initial; }", "<div class=hero><p>Copy</p></div>", true),
    ] {
        let found = site.contrast(&format!("{hero} {rule}"), body);
        if sampled {
            assert!(sampled_on("light.png", &found), "{rule}: {found:?}");
        } else {
            assert!(found.is_empty(), "{rule}: {found:?}");
        }
    }
}

#[test]
fn an_escape_spelling_a_hash_or_a_query_stays_in_the_file_name() {
    let site = Site::new("escaped-hash");
    site.png("hero#light.png", 320, 200, LIGHT);
    // A `?` cannot be part of a file name on Windows; the `#` case covers
    // the resolver there.
    let mut cases = vec![("hero%23light.png", "hero#light.png")];
    if !cfg!(windows) {
        site.png("a?b.png", 320, 200, LIGHT);
        cases.push(("a%3Fb.png", "a?b.png"));
    }
    for (url, file) in cases {
        let css = format!(".hero {{ background: url({url}); }} p {{ color: #fdfdfd; }}");
        let found = site.contrast(&css, "<div class=hero><p>White copy</p></div>");
        assert!(sampled_on(file, &found), "{url}: {found:?}");
    }
}

#[test]
fn the_pre_pass_decodes_nothing_for_text_the_rule_never_measures() {
    let site = Site::new("pre-pass-gates");
    site.png("a.png", 320, 200, LIGHT);
    site.png("b.png", 320, 200, LIGHT);
    let entries = || -> usize {
        std::fs::read_dir(site.0.join("sample-cache"))
            .map(|d| d.count())
            .unwrap_or(0)
    };
    // Links are SAFE_TAGS, scored only on their own surface; transparent
    // and emoji-only text is never measured. Two photos behind such text
    // are not decoded ahead, and the cache stays empty.
    let css = ".a { background: url(a.png); } .b { background: url(b.png); } .faint { color: rgba(0, 0, 0, 0.05); }";
    let body = "<div class=a><a href=/>A link</a></div><div class=b><p class=faint>Faint</p><p>\u{1F600}</p></div>";
    assert!(site.contrast(css, body).is_empty());
    assert_eq!(entries(), 0, "no photo was decoded");
    // Text the color check never scores: in markup the browser does not lay
    // out, `visibility: hidden`, or under an opacity that paints nothing.
    site.png("c.png", 320, 200, LIGHT);
    let css = ".a { background: url(a.png); } .b { background: url(b.png); } .c { background: url(c.png); } .gone { visibility: hidden; } .clear { opacity: 0; } p { color: #fdfdfd; }";
    let body = "<div hidden><div class=a><p>Hidden subtree</p></div></div><div class=b><p class=gone>Invisible</p></div><div class=clear><div class=c><p>Transparent</p></div></div>";
    assert!(site.contrast(css, body).is_empty());
    assert_eq!(entries(), 0, "no photo behind unscored text was decoded");
    // Measured text over the same photos decodes both.
    let body = "<div class=a><p>One</p></div><div class=b><p>Two</p></div>";
    let css = ".a { background: url(a.png); } .b { background: url(b.png); } p { color: #fdfdfd; }";
    assert_eq!(site.contrast(css, body).len(), 2);
    assert_eq!(entries(), 2);
    // A control whose placeholder the rule never scores queues nothing
    // either: ink at zero alpha (a floating label's), a filled-in value, a
    // type that shows no placeholder, or no `::placeholder` rule at all.
    site.png("d.png", 320, 200, LIGHT);
    let css = ".d { background: url(d.png); } .clear::placeholder { color: transparent; } .inked::placeholder { color: #fdfdfd; }";
    let body = "<input class=\"d clear\" placeholder=\"Search\"><input class=\"d inked\" placeholder=\"Search\" value=\"filled\"><input class=\"d inked\" type=checkbox placeholder=\"Search\"><input class=d placeholder=\"Search\">";
    assert!(site.contrast(css, body).is_empty());
    assert_eq!(entries(), 2, "no photo behind an unscored placeholder was decoded");
    // The placeholder the rule scores decodes its photo.
    let body = "<input class=\"d inked\" placeholder=\"Search\">";
    assert_eq!(site.contrast(css, body).len(), 1);
    assert_eq!(entries(), 3);
}

/// The measured ratio a sampled snippet reports.
fn ratio_of(snippet: &str) -> f64 {
    snippet
        .trim_start_matches("sampled (coarse) ")
        .split(":1")
        .next()
        .unwrap()
        .parse()
        .unwrap()
}

#[test]
fn a_spaced_image_does_not_fill_its_axis() {
    let site = Site::new("space");
    // `space` leaves gaps and paints once when two tiles do not fit, so a
    // light image over an opaque dark color does not replace the color as
    // the ground. Tiled with `repeat` or `round`, it does.
    for (repeat, sampled) in [
        ("space", false),
        ("space repeat", false),
        ("repeat", true),
        ("round", true),
    ] {
        let css = format!(
            ".hero {{ background: #17150f url(light.png) {repeat}; }} p {{ color: #fdfdfd; }}"
        );
        let found = site.contrast(&css, "<div class=hero><p>White copy</p></div>");
        if sampled {
            assert!(sampled_on("light.png", &found), "{repeat}: {found:?}");
        } else {
            assert!(found.is_empty(), "{repeat}: {found:?}");
        }
    }
}

#[test]
fn a_shifted_image_is_not_known_to_cover_a_color() {
    let site = Site::new("position");
    // A `background-position` that is a keyword, a percentage, or zero
    // keeps the image in its box. A length can push it out and expose the
    // color under it, so the color stays the ground; tiling fills the box
    // wherever the image starts.
    for (layer, sampled) in [
        ("center / 100% 100% no-repeat", true),
        ("50% 50% / 100% 100% no-repeat", true),
        ("right bottom / 100% 100% no-repeat", true),
        ("0 0 / 100% 100% no-repeat", true),
        ("0 200px / 100% 100% no-repeat", false),
        ("0 +200px / 100% 100% no-repeat", false),
        ("150% 0 / cover no-repeat", false),
        ("center 4rem / cover no-repeat", false),
        ("calc(50% - 10px) 0 / cover no-repeat", false),
        ("0 200px / 100% 100% repeat", true),
    ] {
        let css = format!(
            ".hero {{ background: #17150f url(light.png) {layer}; }} p {{ color: #fdfdfd; }}"
        );
        let found = site.contrast(&css, "<div class=hero><p>White copy</p></div>");
        if sampled {
            assert!(sampled_on("light.png", &found), "{layer}: {found:?}");
        } else {
            assert!(found.is_empty(), "{layer}: {found:?}");
        }
    }
    // The longhand overrides the shorthand's position.
    let css = ".hero { background: #17150f url(light.png) center / 100% 100% no-repeat; background-position: 0 200px; } p { color: #fdfdfd; }";
    let found = site.contrast(css, "<div class=hero><p>White copy</p></div>");
    assert!(found.is_empty(), "{found:?}");
    // A `background-position` longhand holding a slash is invalid CSS a
    // browser drops; the engine reads it as able to shift the image, the
    // silent side (a tiled image fills the box wherever it starts, so the
    // layer here does not tile).
    let css = ".hero { background: #17150f url(light.png) no-repeat; background-size: 100% 100%; background-position: center / cover; } p { color: #fdfdfd; }";
    let found = site.contrast(css, "<div class=hero><p>White copy</p></div>");
    assert!(found.is_empty(), "{found:?}");
    // A position held in a custom property that stands alone among the
    // shorthand's tokens, the repeat and the color named by others, is read
    // once the property resolves: a length offset leaves the color as the
    // ground, a keyword lets the image cover.
    for (value, sampled) in [("center", true), ("0 200px", false), ("0 +200px", false)] {
        let css = format!(
            ":root {{ --pos: {value}; }} .hero {{ background: #17150f url(light.png) var(--pos) no-repeat; background-size: 100% 100%; }} p {{ color: #fdfdfd; }}"
        );
        let found = site.contrast(&css, "<div class=hero><p>White copy</p></div>");
        if sampled {
            assert!(sampled_on("light.png", &found), "{value}: {found:?}");
        } else {
            assert!(found.is_empty(), "{value}: {found:?}");
        }
    }
    // A position held in a custom property directly before the size slash
    // is read once the property resolves.
    for (value, sampled) in [("center", true), ("0 200px", false)] {
        let css = format!(
            ":root {{ --pos: {value}; }} .hero {{ background: #17150f url(light.png) var(--pos) / 100% 100% no-repeat; }} p {{ color: #fdfdfd; }}"
        );
        let found = site.contrast(&css, "<div class=hero><p>White copy</p></div>");
        if sampled {
            assert!(sampled_on("light.png", &found), "{value}: {found:?}");
        } else {
            assert!(found.is_empty(), "{value}: {found:?}");
        }
    }
    // The custom property that stands alone is stored in the position slot
    // too. What it turns out to hold for another slot, the repeat, the
    // attachment, or the color, is not a position: the image keeps its
    // default place and covers. A length offset beside the repeat is still
    // a shift.
    for (value, sampled) in [
        ("no-repeat", true),
        ("center no-repeat", true),
        ("no-repeat center", true),
        ("local", true),
        ("0 200px no-repeat", false),
    ] {
        let css = format!(
            ":root {{ --tile: {value}; }} .hero {{ background: #17150f url(light.png) var(--tile); background-size: 100% 100%; }} p {{ color: #fdfdfd; }}"
        );
        let found = site.contrast(&css, "<div class=hero><p>White copy</p></div>");
        if sampled {
            assert!(sampled_on("light.png", &found), "{value}: {found:?}");
        } else {
            assert!(found.is_empty(), "{value}: {found:?}");
        }
    }
    let css = ":root { --brand: #17150f; } .hero { background: url(light.png) var(--brand) no-repeat; background-size: 100% 100%; } p { color: #fdfdfd; }";
    let found = site.contrast(css, "<div class=hero><p>White copy</p></div>");
    assert!(sampled_on("light.png", &found), "{found:?}");
    // Beside a literal position component, the custom property may be the
    // next one: an offset held in it is a shift, zero or a keyword is not.
    for (value, sampled) in [("200px", false), ("0", true), ("center", true)] {
        let css = format!(
            ":root {{ --y: {value}; }} .hero {{ background: #17150f url(light.png) 0 var(--y) no-repeat; background-size: 100% 100%; }} p {{ color: #fdfdfd; }}"
        );
        let found = site.contrast(&css, "<div class=hero><p>White copy</p></div>");
        if sampled {
            assert!(sampled_on("light.png", &found), "{value}: {found:?}");
        } else {
            assert!(found.is_empty(), "{value}: {found:?}");
        }
    }
}

#[test]
fn a_layer_painted_inside_the_padding_is_not_the_ground() {
    let site = Site::new("origin");
    let body = "<div class=hero><p>White copy</p></div>";
    // `background-origin: content-box` positions the image inside the
    // padding, which it leaves to the color beneath on an axis it does not
    // tile along, and `background-clip: content-box` clips it there on
    // every axis. Text positioned in that padding is not over the image,
    // and without layout the model cannot tell it from text in the content
    // box. The image covers again without padding on the axis, when it
    // tiles along it, or from the padding or border box.
    let hero = "background: #111 url(light.png) 0 0 / 100% 100%";
    for (rule, sampled) in [
        (format!(".hero {{ padding: 24px; {hero} no-repeat; background-origin: content-box; }}"), false),
        (format!(".hero {{ padding: 0; {hero} no-repeat; background-origin: content-box; }}"), true),
        (format!(".hero {{ padding: 24px; {hero} repeat; background-origin: content-box; }}"), true),
        (format!(".hero {{ padding: 24px; {hero} no-repeat; background-origin: padding-box; }}"), true),
        (format!(".hero {{ padding: 24px; {hero} no-repeat; background-origin: border-box; }}"), true),
        (format!(".hero {{ padding: 24px; {hero} repeat; background-clip: content-box; }}"), false),
        (format!(".hero {{ padding: 24px; {hero} no-repeat content-box; }}"), false),
        (format!(".hero {{ padding: 0 24px; {hero} repeat-y; background-origin: content-box; }}"), false),
        (format!(".hero {{ padding: 24px 0; {hero} repeat-y; background-origin: content-box; }}"), true),
        (format!(".hero {{ padding: var(--pad); {hero} no-repeat; background-origin: content-box; }}"), false),
        // A box keyword held in a custom property reaches the origin and
        // the clip once it resolves.
        (format!(":root {{ --box: content-box; }} .hero {{ padding: 24px; {hero} no-repeat var(--box); }}"), false),
        (format!(":root {{ --box: padding-box; }} .hero {{ padding: 24px; {hero} no-repeat var(--box); }}"), true),
    ] {
        let found = site.contrast(&format!("{rule} p {{ color: #fdfdfd; }}"), body);
        if sampled {
            assert!(sampled_on("light.png", &found), "{rule}: {found:?}");
        } else {
            assert!(found.is_empty(), "{rule}: {found:?}");
        }
    }
}

#[test]
fn a_repeat_held_in_a_custom_property_is_read() {
    let site = Site::new("var-repeat");
    // The icon over an opaque dark color: tiled, its pixels are the ground;
    // `no-repeat` from a custom property leaves the color as the ground.
    for (value, sampled) in [("no-repeat", false), ("repeat", true)] {
        let css = format!(
            ":root {{ --tile: {value}; }} .hero {{ background: #17150f url(icon.png) var(--tile); }} p {{ color: #fdfdfd; }}"
        );
        let found = site.contrast(&css, "<div class=hero><p>White copy</p></div>");
        if sampled {
            assert!(sampled_on("icon.png", &found), "{value}: {found:?}");
        } else {
            assert!(found.is_empty(), "{value}: {found:?}");
        }
    }
    // Every custom property of the layer is read: the position in one and
    // the repeat in another leave the icon where they say.
    for (tile, sampled) in [("no-repeat", false), ("repeat", true)] {
        let css = format!(
            ":root {{ --pos: center; --tile: {tile}; }} .hero {{ background: #17150f url(icon.png) var(--pos) var(--tile); }} p {{ color: #fdfdfd; }}"
        );
        let found = site.contrast(&css, "<div class=hero><p>White copy</p></div>");
        if sampled {
            assert!(sampled_on("icon.png", &found), "{tile}: {found:?}");
        } else {
            assert!(found.is_empty(), "{tile}: {found:?}");
        }
    }
    // A custom property holding a color is not the repeat: the shorthand
    // names none and the icon tiles.
    let css = ":root { --brand: #17150f; } .hero { background: url(icon.png) var(--brand); } p { color: #fdfdfd; }";
    let found = site.contrast(css, "<div class=hero><p>White copy</p></div>");
    assert!(sampled_on("icon.png", &found), "{found:?}");
    // A repeat keyword beside the custom property wins.
    let css = ":root { --brand: #17150f; } .hero { background: url(icon.png) var(--brand) no-repeat; } p { color: #fdfdfd; }";
    let found = site.contrast(css, "<div class=hero><p>White copy</p></div>");
    assert!(found.is_empty(), "{found:?}");
    // A size the generator writes glued (`100%auto`) is read apart: the
    // x axis is covered by the percentage and the y axis by tiling.
    let css = ".hero { background: #17150f url(light.png) no-repeat repeat; background-size: 100% auto; } p { color: #fdfdfd; }";
    let found = site.contrast(css, "<div class=hero><p>White copy</p></div>");
    assert!(sampled_on("light.png", &found), "{found:?}");
    // A custom property before the repeat keyword names the x axis: the
    // image fills the box only when the axis the size leaves open tiles.
    for (x, sampled) in [("repeat", false), ("no-repeat", true)] {
        let css = format!(
            ":root {{ --x: {x}; }} .hero {{ background: #17150f url(light.png) var(--x) {}; background-size: 100% auto; }} p {{ color: #fdfdfd; }}",
            if x == "repeat" { "no-repeat" } else { "repeat" }
        );
        let found = site.contrast(&css, "<div class=hero><p>White copy</p></div>");
        if sampled {
            assert!(sampled_on("light.png", &found), "{x}: {found:?}");
        } else {
            assert!(found.is_empty(), "{x}: {found:?}");
        }
    }
}

#[test]
fn a_color_held_in_a_custom_property_after_the_image_is_the_fallback() {
    let site = Site::new("var-color");
    let root = ":root { --brand: #17150f; }";
    // The color is the ground where the image does not provably cover the
    // box, as a literal would be: the photo is not sampled.
    for value in ["var(--brand)", "#17150f"] {
        let css = format!(
            "{root} .hero {{ background: url(light.png) no-repeat {value}; }} p {{ color: #fdfdfd; }}"
        );
        let found = site.contrast(&css, "<div class=hero><p>White copy</p></div>");
        assert!(found.is_empty(), "{value}: {found:?}");
    }
    // A translucent texture composites over that color, not over the page.
    for value in ["var(--brand)", "#17150f"] {
        let css = format!(
            "{root} .hero {{ background: url(cutout.png) {value}; }} p {{ color: #262421; }}"
        );
        let found = site.contrast(&css, "<div class=hero><p>Dark copy</p></div>");
        assert!(sampled_on("cutout.png", &found), "{value}: {found:?}");
    }
    let css = ".hero { background: url(cutout.png); } p { color: #262421; }";
    let found = site.contrast(css, "<div class=hero><p>Dark copy</p></div>");
    assert!(found.is_empty(), "{found:?}");
    // A literal color beside a custom property that holds the repeat is
    // still the fallback color, so the non-covering photo stays off the
    // ground.
    let css = ":root { --tile: no-repeat; } .hero { background: url(light.png) #17150f var(--tile); } p { color: #fdfdfd; }";
    let found = site.contrast(css, "<div class=hero><p>White copy</p></div>");
    assert!(found.is_empty(), "{found:?}");
}

#[test]
fn a_geometry_token_in_the_color_slot_hides_no_gradient() {
    let site = Site::new("var-geometry");
    // The custom property held the repeat, not a color: the color slot
    // computes as `transparent`, and the analytic path still reads the
    // opaque gradient under the faint text, as it did before the slot
    // existed. An unresolved property leaves the declaration invalid in a
    // browser, which paints no gradient, so that case stays silent.
    let css = ":root { --tile: no-repeat; } .x { background: linear-gradient(#fff, #fff) var(--tile); color: #eee; }";
    let found = site.contrast(css, "<p class=x>Faint copy</p>");
    assert!(
        found.len() == 1 && !found[0].starts_with("sampled"),
        "{found:?}"
    );
    let css = ".x { background: linear-gradient(#fff, #fff) var(--tile); color: #eee; }";
    let found = site.contrast(css, "<p class=x>Faint copy</p>");
    assert!(found.is_empty(), "{found:?}");
}

#[test]
fn an_escaped_paren_in_a_file_name_opens_no_call() {
    let site = Site::new("escaped-paren");
    site.png("icon(1).png", 24, 24, LIGHT);
    // The generator writes `url(icon\(1\).png)`: the keywords after it are
    // still read, so the icon stays an icon over its fallback color.
    let css = ".hero { background: #17150f url(\"icon(1).png\") no-repeat; } p { color: #fdfdfd; }";
    let found = site.contrast(css, "<div class=hero><p>White copy</p></div>");
    assert!(found.is_empty(), "{found:?}");
    let css = ".hero { background: #17150f url(\"icon(1).png\"); } p { color: #fdfdfd; }";
    let found = site.contrast(css, "<div class=hero><p>White copy</p></div>");
    assert!(sampled_on("icon(1).png", &found), "{found:?}");
}

#[test]
fn a_shifted_wash_does_not_tint_every_sample() {
    let site = Site::new("wash-position");
    let dark_text = "p { color: #262421; }";
    // A wash that fills the box darkens the light image under the dark
    // copy; shifted by a length it leaves part of the image untinted, and
    // the walk gives up rather than tint what it cannot place.
    for (layer, sampled) in [
        ("center / 100% 100% no-repeat", true),
        ("0 200px / 100% 100% no-repeat", false),
        ("0 200px / 100% 100% repeat", true),
    ] {
        let css = format!(
            ".hero {{ background: linear-gradient(rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0.6)) {layer}, url(light.png); }} {dark_text}"
        );
        let found = site.contrast(&css, "<div class=hero><p>Dark copy</p></div>");
        if sampled {
            assert!(sampled_on("light.png", &found), "{layer}: {found:?}");
        } else {
            assert!(found.is_empty(), "{layer}: {found:?}");
        }
    }
    // A wash painted inside the padding tints the content box and leaves
    // the padding to the untinted image, where positioned dark copy reads
    // fine: the walk gives up, as for the image below it. It tints every
    // sample again without padding, or when it tiles over the padding box.
    let wash = "linear-gradient(rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0.6))";
    for (rule, sampled) in [
        (format!(".hero {{ padding: 24px; background: {wash} center / 100% 100% no-repeat, url(light.png); background-clip: content-box, border-box; }}"), false),
        (format!(".hero {{ padding: 24px; background: {wash} center / 100% 100% no-repeat, url(light.png); background-origin: content-box, padding-box; }}"), false),
        (format!(".hero {{ padding: 24px; background: {wash} center / 100% 100% no-repeat content-box, url(light.png); }}"), false),
        (format!(".hero {{ padding: 0; background: {wash} center / 100% 100% no-repeat, url(light.png); background-clip: content-box, border-box; }}"), true),
        (format!(".hero {{ padding: 24px; background: {wash} repeat, url(light.png); background-origin: content-box, padding-box; }}"), true),
        // The image's own entry in the list is read for the image.
        (format!(".hero {{ padding: 24px; background: {wash} center / 100% 100% no-repeat, url(light.png); background-clip: border-box, content-box; }}"), false),
        // Two box keywords in the shorthand set the wash's origin then its
        // clip: tiled, it is still clipped to the content box.
        (format!(".hero {{ padding: 24px; background: {wash} repeat padding-box content-box, url(light.png); }}"), false),
        (format!(".hero {{ padding: 0; background: {wash} repeat padding-box content-box, url(light.png); }}"), true),
    ] {
        let found = site.contrast(&format!("{rule} {dark_text}"), "<div class=hero><p>Dark copy</p></div>");
        if sampled {
            assert!(sampled_on("light.png", &found), "{rule}: {found:?}");
        } else {
            assert!(found.is_empty(), "{rule}: {found:?}");
        }
    }
}

#[test]
fn a_boxless_wrapper_does_not_fade_the_text() {
    let site = Site::new("contents-opacity");
    // `display: contents` generates no box, so its opacity applies to
    // nothing: white copy stays white on the dark image.
    let css = ".hero { background: url(dark.png); } .wrap { display: contents; opacity: 0.2; } p { color: #fdfdfd; }";
    let found = site.contrast(
        css,
        "<div class=hero><div class=wrap><p>Copy</p></div></div>",
    );
    assert!(found.is_empty(), "{found:?}");
}

#[test]
fn faded_text_is_measured_as_seen() {
    let site = Site::new("opacity");
    let hero = ".hero { background: url(dark.png); }";
    for (fade, body, sampled) in [
        // White reads on the dark image; at a fifth of its opacity it does
        // not, whether the fade is on the text or on a box between the text
        // and the image.
        (
            "p { color: #fdfdfd; }",
            "<div class=hero><p>Copy</p></div>",
            false,
        ),
        (
            "p { color: #fdfdfd; opacity: 0.2; }",
            "<div class=hero><p>Copy</p></div>",
            true,
        ),
        (
            "p { color: #fdfdfd; } .faded { opacity: 0.2; }",
            "<div class=hero><div class=faded><p>Copy</p></div></div>",
            true,
        ),
        // The image element's own opacity fades image and text alike.
        (
            ".hero { opacity: 0.2; } p { color: #fdfdfd; }",
            "<div class=hero><p>Copy</p></div>",
            false,
        ),
        // Faint enough, the text is hidden on purpose and not measured.
        (
            "p { color: #fdfdfd; opacity: 0.05; }",
            "<div class=hero><p>Copy</p></div>",
            false,
        ),
        // A percentage is the same fraction, on the text or on a box.
        (
            "p { color: #fdfdfd; opacity: 20%; }",
            "<div class=hero><p>Copy</p></div>",
            true,
        ),
        (
            "p { color: #fdfdfd; } .faded { opacity: 20%; }",
            "<div class=hero><div class=faded><p>Copy</p></div></div>",
            true,
        ),
        (
            "p { color: #fdfdfd; opacity: 5%; }",
            "<div class=hero><p>Copy</p></div>",
            false,
        ),
        (
            "p { color: #fdfdfd; opacity: 100%; }",
            "<div class=hero><p>Copy</p></div>",
            false,
        ),
    ] {
        let found = site.contrast(&format!("{hero} {fade}"), body);
        if sampled {
            assert!(sampled_on("dark.png", &found), "{fade}: {found:?}");
        } else {
            assert!(found.is_empty(), "{fade}: {found:?}");
        }
    }
}

#[test]
fn a_fill_inside_a_faded_box_fades_with_it() {
    let site = Site::new("fold");
    // A dark translucent card at a third of its opacity over the light
    // image: the browser composites the card and its text together, so the
    // white copy reads against a barely tinted ground, not against the
    // card's own dark. Over the card's dark it would clear 10:1, and a
    // blend of faded text over the unfaded card reads about 2.4:1.
    let css = ".hero { background: url(light.png); } .card { background: rgba(0, 0, 0, 0.8); opacity: 0.3; } p { color: #fff; }";
    let found = site.contrast(
        css,
        "<div class=hero><div class=card><p>Copy</p></div></div>",
    );
    assert!(sampled_on("light.png", &found), "{found:?}");
    assert!(ratio_of(&found[0]) < 2.1, "{found:?}");
    // The same card at full opacity is a ground the text reads on.
    let css = ".hero { background: url(light.png); } .card { background: rgba(0, 0, 0, 0.8); } p { color: #fff; }";
    let found = site.contrast(
        css,
        "<div class=hero><div class=card><p>Copy</p></div></div>",
    );
    assert!(found.is_empty(), "{found:?}");
}

#[test]
fn a_stretched_pseudo_that_paints_stops_the_walk() {
    let site = Site::new("overlay");
    let page = ".hero { position: relative; background: url(light.png); } p { color: #fdfdfd; }";
    for (pseudo, sampled) in [
        // A scrim, a gradient, or a picture stretched over the image is not
        // in the samples: the walk gives up.
        (
            ".hero::before { content: ''; position: absolute; inset: 0; background: rgba(0, 0, 0, 0.6); }",
            false,
        ),
        (
            ".hero::after { content: ''; position: absolute; top: 0; right: 0; bottom: 0; left: 0; background: linear-gradient(rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0.2)); }",
            false,
        ),
        (
            ".hero::before { content: ''; position: absolute; width: 100%; height: 100%; background: url(dark.png); }",
            false,
        ),
        // A value the engine cannot read is paint it cannot see through.
        (
            ".hero::before { content: ''; position: absolute; inset: 0; background: var(--scrim); }",
            false,
        ),
        // Too faint to count, painting nothing, not stretched over the box,
        // or never rendered for want of `content`: the image is still the
        // ground.
        (
            ".hero::before { content: ''; position: absolute; inset: 0; background: rgba(0, 0, 0, 0.01); }",
            true,
        ),
        (
            ".hero::before { content: ''; position: absolute; inset: 0; background: none; }",
            true,
        ),
        (
            ".hero::before { content: ''; position: absolute; inset: 0; }",
            true,
        ),
        (
            ".hero::before { content: ''; position: absolute; top: 0; left: 0; width: 50%; height: 100%; background: rgba(0, 0, 0, 0.6); }",
            true,
        ),
        (
            ".hero::before { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.6); }",
            true,
        ),
    ] {
        let found = site.contrast(
            &format!("{page} {pseudo}"),
            "<div class=hero><p>White copy</p></div>",
        );
        if sampled {
            assert!(sampled_on("light.png", &found), "{pseudo}: {found:?}");
        } else {
            assert!(found.is_empty(), "{pseudo}: {found:?}");
        }
    }
}

#[test]
fn an_escaped_path_resolves_to_its_file() {
    let site = Site::new("escaped");
    site.png("light (copy).png", 320, 200, LIGHT);
    site.png("100%.png", 320, 200, LIGHT);
    for (url, file) in [
        ("light%20%28copy%29.png", "light (copy).png"),
        ("\"light%20%28copy%29.png?v=2\"", "light (copy).png"),
        ("100%25.png", "100%.png"),
    ] {
        let css = format!(".hero {{ background: url({url}); }} p {{ color: #fdfdfd; }}");
        let found = site.contrast(&css, "<div class=hero><p>White copy</p></div>");
        assert!(sampled_on(file, &found), "{url}: {found:?}");
    }
    // An escape that is not two hex digits is kept as written: there is no
    // such file, so the skip stays.
    let css = ".hero { background: url(light%2.png); } p { color: #fdfdfd; }";
    let found = site.contrast(css, "<div class=hero><p>White copy</p></div>");
    assert!(found.is_empty(), "{found:?}");
}

#[test]
fn a_zero_sized_layer_paints_nothing() {
    let site = Site::new("zero-size");
    // `background-size: 0` hides the image: the browser lays out no tile
    // however the layer repeats, so the light pixels are not the ground
    // and white copy on the dark fallback is not flagged.
    for size in ["0px", "0", "0%", "0 auto"] {
        let css = format!(
            ".hero {{ background: #17150f url(light.png) 0 0 / {size} repeat; }} p {{ color: #fdfdfd; }}"
        );
        let found = site.contrast(&css, "<div class=hero><p>White copy</p></div>");
        assert!(found.is_empty(), "{size}: {found:?}");
    }
    // The layer is read past like `none`: a zero-sized dark image on a
    // wrapper leaves the parent's light image as the ground.
    let css = ".hero { background: url(light.png); } .inner { background: url(dark.png) 0 0 / 0px repeat; } p { color: #fdfdfd; }";
    let found = site.contrast(css, "<div class=hero><div class=inner><p>White copy</p></div></div>");
    assert!(sampled_on("light.png", &found), "{found:?}");
    // A wash sized to zero paints nothing either: it tints no sample, and
    // white copy on the light image beneath it fails as it does on the page.
    let css = ".hero { background: linear-gradient(rgba(23, 21, 15, 0.9), rgba(23, 21, 15, 0.9)) 0 0 / 0px repeat, url(light.png); } p { color: #fdfdfd; }";
    let found = site.contrast(css, "<div class=hero><p>White copy</p></div>");
    assert!(sampled_on("light.png", &found), "{found:?}");
}

#[test]
fn a_size_held_in_a_custom_property_is_read() {
    let site = Site::new("var-size");
    // `--layout: center / cover` stretches the icon over the box: its
    // pixels are the ground, not the dark fallback.
    for layout in ["center / cover", "center/cover", "center / cover no-repeat"] {
        let css = format!(
            ":root {{ --layout: {layout}; }} .hero {{ background: #17150f url(icon.png) var(--layout) no-repeat; }} p {{ color: #fdfdfd; }}"
        );
        let found = site.contrast(&css, "<div class=hero><p>White copy</p></div>");
        assert!(sampled_on("icon.png", &found), "{layout}: {found:?}");
    }
    // The same custom property holding only a position leaves the icon its
    // size: decoration, and the color stays the ground.
    for layout in ["center", "50% 50%", "right 8px top 8px"] {
        let css = format!(
            ":root {{ --layout: {layout}; }} .hero {{ background: #17150f url(icon.png) var(--layout) no-repeat; }} p {{ color: #fdfdfd; }}"
        );
        let found = site.contrast(&css, "<div class=hero><p>White copy</p></div>");
        assert!(found.is_empty(), "{layout}: {found:?}");
    }
    // A size the property holds beside a literal position, and one that
    // fills the box only along one axis, are read the same way.
    let css = ":root { --size: / 100% 100%; } .hero { background: #17150f url(icon.png) center var(--size) no-repeat; } p { color: #fdfdfd; }";
    let found = site.contrast(css, "<div class=hero><p>White copy</p></div>");
    assert!(sampled_on("icon.png", &found), "{found:?}");
    let css = ":root { --layout: center / 100% auto; } .hero { background: #17150f url(icon.png) var(--layout) no-repeat; } p { color: #fdfdfd; }";
    let found = site.contrast(css, "<div class=hero><p>White copy</p></div>");
    assert!(found.is_empty(), "{found:?}");
    // Each slot carries its own copy of the property, as the cascade does:
    // a later `background-size` longhand resets the size the property held
    // and leaves the icon small, and a later `background-position` longhand
    // moves the icon without taking its size away.
    let css = ":root { --layout: center / cover; } .hero { background: #17150f url(icon.png) var(--layout) no-repeat; background-size: auto; } p { color: #fdfdfd; }";
    let found = site.contrast(css, "<div class=hero><p>White copy</p></div>");
    assert!(found.is_empty(), "{found:?}");
    let css = ":root { --layout: center / cover; } .hero { background: #17150f url(icon.png) var(--layout) no-repeat; background-position: left top; } p { color: #fdfdfd; }";
    let found = site.contrast(css, "<div class=hero><p>White copy</p></div>");
    assert!(sampled_on("icon.png", &found), "{found:?}");
    // The longhand declared first loses to the shorthand after it.
    let css = ":root { --layout: center / cover; } .hero { background-size: auto; background: #17150f url(icon.png) var(--layout) no-repeat; } p { color: #fdfdfd; }";
    let found = site.contrast(css, "<div class=hero><p>White copy</p></div>");
    assert!(sampled_on("icon.png", &found), "{found:?}");
    // A literal component after the property continues what it held: a
    // second size behind its slash (`100% 100%`), or a second position
    // component when it held no slash.
    let css = ":root { --layout: center / 100%; } .hero { background: #17150f url(icon.png) var(--layout) 100% no-repeat; } p { color: #fdfdfd; }";
    let found = site.contrast(css, "<div class=hero><p>White copy</p></div>");
    assert!(sampled_on("icon.png", &found), "{found:?}");
    let css = ":root { --layout: center; } .hero { background: #17150f url(icon.png) var(--layout) 100% no-repeat; } p { color: #fdfdfd; }";
    let found = site.contrast(css, "<div class=hero><p>White copy</p></div>");
    assert!(found.is_empty(), "{found:?}");
}

#[test]
fn an_image_backed_placeholder_is_measured() {
    let site = Site::new("placeholder");
    let field = "<input class=search placeholder=\"Search the site\">";
    // Placeholder ink over a light image: the analytic placeholder check
    // has no resolved ground there and used to pass it; the sampler reads
    // the pixels with the `::placeholder` color in place of the host's text.
    let css = ".search { background: url(light.png); border: 0; } .search::placeholder { color: #fdfdfd; }";
    let found = site.contrast(css, field);
    assert_eq!(found.len(), 1, "{found:?}");
    assert!(
        found[0].starts_with("placeholder \"Search the site\" sampled (coarse) "),
        "{found:?}"
    );
    assert!(found[0].contains(" on light.png;"), "{found:?}");
    // The same ink reads on the dark image.
    let css = ".search { background: url(dark.png); border: 0; } .search::placeholder { color: #fdfdfd; }";
    assert!(site.contrast(css, field).is_empty());
    // A fallback color the image covers gets no say, as for the host's own
    // text: ink that reads on the color but not on the image is flagged on
    // the image, and ink that reads on the image but not on the color is
    // not flagged against the color.
    let css = ".search { background: #17150f url(light.png) center / cover; border: 0; } .search::placeholder { color: #fdfdfd; }";
    let found = site.contrast(css, field);
    assert_eq!(found.len(), 1, "{found:?}");
    assert!(found[0].contains("sampled (coarse)"), "{found:?}");
    let css = ".search { background: #f4f1ea url(dark.png) center / cover; border: 0; } .search::placeholder { color: #fdfdfd; }";
    assert!(site.contrast(css, field).is_empty());
    // The placeholder's own `opacity` fades its ink before either check:
    // hidden at zero, measured as seen otherwise (white at 0.3 over the
    // dark image fails). The host's own opacity fades image and ink alike
    // and, as for the host's text, is not applied.
    let css = ".search { background: url(light.png); border: 0; } .search::placeholder { color: #fdfdfd; opacity: 0; }";
    assert!(site.contrast(css, field).is_empty(), "hidden placeholder");
    let placeholder_sampled_on = |image: &str, found: &[String]| {
        found.len() == 1
            && found[0].starts_with("placeholder \"Search the site\" sampled (coarse) ")
            && found[0].contains(&format!(" on {image};"))
    };
    let css = ".search { background: url(dark.png); border: 0; } .search::placeholder { color: #fdfdfd; opacity: 0.3; }";
    let found = site.contrast(css, field);
    assert!(placeholder_sampled_on("dark.png", &found), "{found:?}");
    let css = ".search { background: url(dark.png); border: 0; opacity: 0.3; } .search::placeholder { color: #fdfdfd; }";
    assert!(site.contrast(css, field).is_empty(), "host opacity");
    // A percentage fades the placeholder's ink the same way.
    let css = ".search { background: url(light.png); border: 0; } .search::placeholder { color: #fdfdfd; opacity: 0%; }";
    assert!(site.contrast(css, field).is_empty(), "placeholder opacity 0%");
    let css = ".search { background: url(dark.png); border: 0; } .search::placeholder { color: #fdfdfd; opacity: 30%; }";
    let found = site.contrast(css, field);
    assert!(placeholder_sampled_on("dark.png", &found), "placeholder opacity 30%: {found:?}");
    // And the analytic check reads the same faded ink: gray ink at zero
    // opacity on a white field is not flagged against the white.
    let css = ".search { background: #fdfdfd; border: 0; } .search::placeholder { color: #999; opacity: 0; }";
    assert!(site.contrast(css, field).is_empty(), "hidden placeholder on a color");
    // The hook reads only what `detect` sampled: an image no scan sampled
    // yet is silent there, and read once `detect` has cached it.
    site.png("field.png", 320, 200, LIGHT);
    let css = ".search { background: url(field.png); border: 0; } .search::placeholder { color: #fdfdfd; }";
    assert!(site.contrast_as(css, field, ImageSamples::CacheOnly).is_empty());
    assert_eq!(site.contrast(css, field).len(), 1);
    assert_eq!(site.contrast_as(css, field, ImageSamples::CacheOnly).len(), 1);
}

#[test]
fn a_fixed_background_is_not_known_to_cover() {
    let site = Site::new("fixed");
    let body = "<section><div class=hero><p>White copy</p></div></section>";
    // `background-attachment: fixed` positions the image against the
    // viewport: where it meets the box depends on layout, so the ground is
    // not known and the skip stands. `scroll` and `local` stay with the box.
    for decl in [
        "background: url(light.png) left top no-repeat fixed",
        "background: url(light.png); background-attachment: fixed",
        "background: url(light.png) fixed, none",
    ] {
        let css = format!("{DARK_SECTION} .hero {{ {decl}; }} p {{ color: #fdfdfd; }}");
        let found = site.contrast(&css, body);
        assert!(found.is_empty(), "{decl}: {found:?}");
    }
    for att in ["scroll", "local"] {
        let css = format!("{DARK_SECTION} .hero {{ background: url(light.png) {att}; }} p {{ color: #fdfdfd; }}");
        let found = site.contrast(&css, body);
        assert!(sampled_on("light.png", &found), "{att}: {found:?}");
    }
    // A custom property holding the attachment is read like a keyword.
    for (att, sampled) in [("fixed", false), ("scroll", true)] {
        let css = format!(":root {{ --att: {att}; }} {DARK_SECTION} .hero {{ background: url(light.png) var(--att); }} p {{ color: #fdfdfd; }}");
        let found = site.contrast(&css, body);
        assert_eq!(sampled_on("light.png", &found), sampled, "{att}: {found:?}");
    }
    // A fixed wash over the image is not known to tint every sample: the
    // walk stops rather than darken the ink's ground.
    let css = ".hero { background: linear-gradient(rgba(23, 21, 15, 0.9), rgba(23, 21, 15, 0.9)) fixed, url(light.png); } p { color: #262421; }";
    let found = site.contrast(css, "<div class=hero><p>Ink</p></div>");
    assert!(found.is_empty(), "{found:?}");
}

#[test]
fn a_pseudo_overlay_split_across_rules_still_stops_the_walk() {
    let site = Site::new("split-pseudo");
    let body = "<div class=hero><p>White copy</p></div>";
    // The overlay's geometry and its paint come from two rules on the same
    // pseudo-element; combined, they are the stretched dark overlay the
    // walk gives up on, as it does when one rule carries both.
    let css = ".hero { background: url(light.png); position: relative; } .hero::before { content: ''; position: absolute; inset: 0; } .hero::before { background: linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.7)); } p { position: relative; color: #fdfdfd; }";
    let found = site.contrast(css, body);
    assert!(found.is_empty(), "{found:?}");
    // A `background` shorthand resets the longhands declared before it: an
    // earlier clear `background-color` does not hide the paint of a later
    // complete rule.
    let css = ".hero { background: url(light.png); position: relative; } .hero::before { background-color: rgba(0, 0, 0, 0); } .hero::before { content: ''; position: absolute; inset: 0; background: linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.7)); } p { position: relative; color: #fdfdfd; }";
    let found = site.contrast(css, body);
    assert!(found.is_empty(), "{found:?}");
    // A longhand declared after the shorthand wins its slot back: the
    // translucent fill is cleared (`transparent` is known not to paint,
    // though no color parser reads it), and nothing is painted over the
    // image.
    let css = ".hero { background: url(light.png); position: relative; } .hero::before { content: ''; position: absolute; inset: 0; background: rgba(0, 0, 0, 0.5); } .hero::before { background-color: transparent; } p { position: relative; color: #fdfdfd; }";
    let found = site.contrast(css, body);
    assert!(sampled_on("light.png", &found), "{found:?}");
    // The shorthand's image part paints whatever a later longhand does to
    // the color: a cleared color under a gradient is still the gradient.
    let css = ".hero { background: url(light.png); position: relative; } .hero::before { content: ''; position: absolute; inset: 0; background: linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.7)); } .hero::before { background-color: transparent; } p { position: relative; color: #fdfdfd; }";
    let found = site.contrast(css, body);
    assert!(found.is_empty(), "{found:?}");
    // A clear color declared after the shorthand in the same rule wins its
    // slot, however the earlier rules ordered the keys: nothing is painted.
    let css = ".hero { background: url(light.png); position: relative; } .hero::before { background-color: rgba(0, 0, 0, 0); } .hero::before { content: ''; position: absolute; inset: 0; background: rgba(0, 0, 0, 0.5); background-color: rgba(0, 0, 0, 0); } p { position: relative; color: #fdfdfd; }";
    let found = site.contrast(css, body);
    assert!(sampled_on("light.png", &found), "{found:?}");
    // The two rules may sit on two selectors that match the same element.
    let css = ".hero { background: url(light.png); position: relative; } .hero::before { content: ''; position: absolute; inset: 0; } .dark::before { background: linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.7)); } p { position: relative; color: #fdfdfd; }";
    let found = site.contrast(css, "<div class=\"hero dark\"><p>White copy</p></div>");
    assert!(found.is_empty(), "{found:?}");
    // A later rule that takes the paint away leaves the image as the ground
    // (an opaque fill is the analytic path's surface, read rule by rule as
    // the JS did, so the scrim here is translucent).
    let css = ".hero { background: url(light.png); position: relative; } .hero::before { content: ''; position: absolute; inset: 0; background: rgba(0, 0, 0, 0.5); } .hero::before { background: none; } p { position: relative; color: #fdfdfd; }";
    let found = site.contrast(css, body);
    assert!(sampled_on("light.png", &found), "{found:?}");
}

#[test]
fn a_custom_property_that_adds_layers_leaves_the_level_unknown() {
    let site = Site::new("var-layers");
    let body = "<div class=hero><p>Ink outside the patch</p></div>";
    // `--wash` holds a whole layer and a comma, so the shorthand's single
    // layer becomes two once resolved and nothing stored per layer lines up
    // with them: the level is not known and the skip stands, rather than a
    // 20px patch tinting every sample.
    let css = ":root { --wash: linear-gradient(rgba(23, 21, 15, 0.9), rgba(23, 21, 15, 0.9)) 0 0 / 20px 20px no-repeat,; } .hero { background: var(--wash) url(light.png) center / cover; } p { color: #262421; }";
    let found = site.contrast(css, body);
    assert!(found.is_empty(), "{found:?}");
    // A property holding exactly one layer's tokens still lines up.
    let css = ":root { --layer: center / cover no-repeat; } .hero { background: #111 url(light.png) var(--layer); } p { color: #fdfdfd; }";
    let found = site.contrast(css, body);
    assert!(sampled_on("light.png", &found), "{found:?}");
}

#[test]
fn a_cleared_image_leaves_a_pseudo_painting_nothing() {
    let site = Site::new("cleared-image");
    let body = "<div class=hero><p>White copy</p></div>";
    // The shorthand named a picture; a later `background-image: none` takes
    // it away and the shorthand named no color, so the pseudo paints
    // nothing and the host's image stays the ground.
    let css = ".hero { background: url(light.png); position: relative; } .hero::before { content: ''; position: absolute; inset: 0; background: url(dark.png); } .hero::before { background-image: none; } p { position: relative; color: #fdfdfd; }";
    let found = site.contrast(css, body);
    assert!(sampled_on("light.png", &found), "{found:?}");
    // The shorthand's color stays when only the image is cleared.
    let css = ".hero { background: url(light.png); position: relative; } .hero::before { content: ''; position: absolute; inset: 0; background: #000 url(dark.png); } .hero::before { background-image: none; } p { position: relative; color: #fdfdfd; }";
    let found = site.contrast(css, body);
    assert!(found.is_empty(), "{found:?}");
    // A shorthand held in a custom property is read once resolved: a
    // gradient in it is an image, cleared by the later longhand too.
    let css = ":root { --scrim: linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.7)); } .hero { background: url(light.png); position: relative; } .hero::before { content: ''; position: absolute; inset: 0; background: var(--scrim); } .hero::before { background-image: none; } p { position: relative; color: #fdfdfd; }";
    let found = site.contrast(css, body);
    assert!(sampled_on("light.png", &found), "{found:?}");
    let css = ":root { --scrim: linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.7)); } .hero { background: url(light.png); position: relative; } .hero::before { content: ''; position: absolute; inset: 0; background: var(--scrim); } p { position: relative; color: #fdfdfd; }";
    let found = site.contrast(css, body);
    assert!(found.is_empty(), "{found:?}");
}

#[test]
fn a_side_declared_later_moves_the_pseudo_off_the_box() {
    let site = Site::new("shifted-pseudo");
    let body = "<div class=hero><p>White copy</p></div>";
    // `inset: 0` in one rule and `top: 200px` in a later one: the pseudo
    // starts below the heading, so it is not read as an overlay over it.
    let css = ".hero { background: url(light.png); position: relative; } .hero::before { content: ''; position: absolute; inset: 0; background: rgba(0, 0, 0, 0.5); } .hero::before { top: 200px; } p { position: relative; color: #fdfdfd; }";
    let found = site.contrast(css, body);
    assert!(sampled_on("light.png", &found), "{found:?}");
    // The same two declarations in one rule read the same way.
    let css = ".hero { background: url(light.png); position: relative; } .hero::before { content: ''; position: absolute; inset: 0; top: 200px; background: rgba(0, 0, 0, 0.5); } p { position: relative; color: #fdfdfd; }";
    let found = site.contrast(css, body);
    assert!(sampled_on("light.png", &found), "{found:?}");
    // A later rule that puts the side back to zero restores the overlay.
    let css = ".hero { background: url(light.png); position: relative; } .hero::before { content: ''; position: absolute; inset: 0; top: 200px; background: rgba(0, 0, 0, 0.5); } .hero::before { top: 0; } p { position: relative; color: #fdfdfd; }";
    let found = site.contrast(css, body);
    assert!(found.is_empty(), "{found:?}");
}

#[test]
fn a_wash_clipped_to_the_content_box_is_not_known_to_tint() {
    let site = Site::new("clipped-wash");
    let body = "<div class=hero><div class=wrap><p>Ink</p></div></div>";
    // A wrapper's translucent color clipped to its content box leaves its
    // padding untinted, and without layout the walk cannot tell text in the
    // padding from text in the content box: it stops rather than darken
    // every sample.
    for clip in ["content-box", "text"] {
        let css = format!(".hero {{ background: url(light.png); }} .wrap {{ padding: 24px; background: rgba(23, 21, 15, 0.7); background-clip: {clip}; }} p {{ color: #262421; }}");
        let found = site.contrast(&css, body);
        assert!(found.is_empty(), "{clip}: {found:?}");
    }
    // Clipped to the padding or border box, or to the content box without
    // padding, the wash covers the box and tints every sample.
    for (clip, padding) in [("padding-box", "24px"), ("border-box", "24px"), ("content-box", "0")] {
        let css = format!(".hero {{ background: url(light.png); }} .wrap {{ padding: {padding}; background: rgba(23, 21, 15, 0.7); background-clip: {clip}; }} p {{ color: #262421; }}");
        let found = site.contrast(&css, body);
        assert!(sampled_on("light.png", &found), "{clip} {padding}: {found:?}");
    }
}

#[test]
fn the_color_takes_the_bottom_layers_clip() {
    let site = Site::new("color-clip-entry");
    let body = "<div class=hero><div class=wrap><p>Ink</p></div></div>";
    // One layer: the first clip entry is the layer's, the rest are ignored,
    // so `content-box, border-box` clips the color to the content box.
    let css = ".hero { background: url(light.png); } .wrap { padding: 24px; background: rgba(23, 21, 15, 0.7); background-clip: content-box, border-box; } p { color: #262421; }";
    let found = site.contrast(css, body);
    assert!(found.is_empty(), "{found:?}");
    // `border-box, content-box` clips it to the border box: the wash tints.
    let css = ".hero { background: url(light.png); } .wrap { padding: 24px; background: rgba(23, 21, 15, 0.7); background-clip: border-box, content-box; } p { color: #262421; }";
    let found = site.contrast(css, body);
    assert!(sampled_on("light.png", &found), "{found:?}");
    // Two layers: the color follows the second entry.
    let css = ".hero { background: url(light.png); } .wrap { padding: 24px; background: linear-gradient(rgba(0, 0, 0, 0.1), rgba(0, 0, 0, 0.1)), linear-gradient(rgba(0, 0, 0, 0.1), rgba(0, 0, 0, 0.1)); background-color: rgba(23, 21, 15, 0.7); background-clip: border-box, content-box; } p { color: #262421; }";
    let found = site.contrast(css, body);
    assert!(found.is_empty(), "{found:?}");
}

#[test]
fn a_pseudo_that_generates_no_box_paints_nothing() {
    let site = Site::new("no-box-pseudo");
    let body = "<div class=hero><p>White copy</p></div>";
    for decl in [
        "content: none",
        "content: normal",
        "content: ''; display: none",
        "content: ''; visibility: hidden",
        "content: ''; opacity: 0",
        "content: ''; opacity: 0%",
    ] {
        let css = format!(".hero {{ background: url(light.png); position: relative; }} .hero::before {{ {decl}; position: absolute; inset: 0; background: rgba(0, 0, 0, 0.6); }} p {{ position: relative; color: #fdfdfd; }}");
        let found = site.contrast(&css, body);
        assert!(sampled_on("light.png", &found), "{decl}: {found:?}");
    }
    // A later rule can take the box away, and a faded box still paints.
    let css = ".hero { background: url(light.png); position: relative; } .hero::before { content: ''; position: absolute; inset: 0; background: rgba(0, 0, 0, 0.6); } .hero::before { content: none; } p { position: relative; color: #fdfdfd; }";
    let found = site.contrast(css, body);
    assert!(sampled_on("light.png", &found), "{found:?}");
    for opacity in ["0.5", "50%"] {
        let css = format!(".hero {{ background: url(light.png); position: relative; }} .hero::before {{ content: ''; position: absolute; inset: 0; background: rgba(0, 0, 0, 0.6); opacity: {opacity}; }} p {{ position: relative; color: #fdfdfd; }}");
        let found = site.contrast(&css, body);
        assert!(found.is_empty(), "{opacity}: {found:?}");
    }
}

#[test]
fn a_layer_clipped_to_the_text_is_not_the_ground() {
    let site = Site::new("text-clipped-layer");
    let body = "<div class=hero><p>White copy</p></div>";
    // The first layer paints the glyphs; the second is the ground the
    // white text is read against, and it is dark.
    let css = ".hero { background: #17150f; } p { background-image: url(light.png), url(dark.png); background-clip: text, border-box; color: #fdfdfd; }";
    let found = site.contrast(css, body);
    assert!(!sampled_on("light.png", &found), "{found:?}");
    assert!(found.is_empty(), "{found:?}");
    // The other way round, the light layer beneath is the ground.
    let css = ".hero { background: #17150f; } p { background-image: url(dark.png), url(light.png); background-clip: text, border-box; color: #fdfdfd; }";
    let found = site.contrast(css, body);
    assert!(sampled_on("light.png", &found), "{found:?}");
    // A text-clipped wash tints no ground either.
    let css = ".hero { background: url(light.png); } .tint { background: linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.7)), none; background-clip: text, border-box; } p { color: #fdfdfd; }";
    let found = site.contrast(css, "<div class=hero><div class=tint><p>White copy</p></div></div>");
    assert!(sampled_on("light.png", &found), "{found:?}");
}

#[test]
fn a_shorthand_color_the_engine_cannot_read_is_paint() {
    let site = Site::new("unknown-color");
    let body = "<div class=hero><p>White copy</p></div>";
    // A named color outside the tables, and a color function the parsers
    // do not know: unknown paint over the box, which stops the walk.
    for color in ["darkslategray", "color(display-p3 0.1 0.1 0.1)"] {
        let css = format!(".hero {{ background: url(light.png); position: relative; }} .hero::before {{ content: ''; position: absolute; inset: 0; background: {color}; }} p {{ position: relative; color: #fdfdfd; }}");
        let found = site.contrast(&css, body);
        assert!(found.is_empty(), "{color}: {found:?}");
    }
    // Geometry keywords alone still name no color.
    let css = ".hero { background: url(light.png); position: relative; } .hero::before { content: ''; position: absolute; inset: 0; background: center / cover no-repeat; } p { position: relative; color: #fdfdfd; }";
    let found = site.contrast(css, body);
    assert!(sampled_on("light.png", &found), "{found:?}");
}

#[test]
fn a_content_only_rule_on_another_selector_switches_the_box() {
    let site = Site::new("content-switch");
    // The geometry and paint sit on `.hero::before` with the box off; a
    // content-only rule on another selector turns it on for this element.
    let css = ".hero { background: url(light.png); position: relative; } .hero::before { content: none; position: absolute; inset: 0; background: rgba(0, 0, 0, 0.7); } .enabled::before { content: ''; } p { position: relative; color: #fdfdfd; }";
    let found = site.contrast(css, "<div class=\"hero enabled\"><p>White copy</p></div>");
    assert!(found.is_empty(), "{found:?}");
    // Without the enabling class, the box stays off and the image samples.
    let found = site.contrast(css, "<div class=hero><p>White copy</p></div>");
    assert!(sampled_on("light.png", &found), "{found:?}");
    // And the other way round: a content-only rule turns the box off.
    let css = ".hero { background: url(light.png); position: relative; } .hero::before { content: ''; position: absolute; inset: 0; background: rgba(0, 0, 0, 0.7); } .plain::before { content: none; } p { position: relative; color: #fdfdfd; }";
    let found = site.contrast(css, "<div class=\"hero plain\"><p>White copy</p></div>");
    assert!(sampled_on("light.png", &found), "{found:?}");
}

#[test]
fn a_sized_pseudo_is_a_decoration_not_an_overlay() {
    let site = Site::new("sized-pseudo");
    let body = "<div class=hero><p>White copy</p></div>";
    // Zero offsets on every side do not stretch a pseudo that declares its
    // own size: a 24px patch is not an overlay over the host's text.
    for size in [
        "width: 24px; height: 24px",
        "inline-size: 24px; block-size: 24px",
        "max-width: 24px",
        "width: calc(100% - 20px)",
    ] {
        let css = format!(".hero {{ background: url(light.png); position: relative; }} .hero::before {{ content: ''; position: absolute; inset: 0; {size}; background: rgba(0, 0, 0, 0.6); }} p {{ position: relative; color: #fdfdfd; }}");
        let found = site.contrast(&css, body);
        assert!(sampled_on("light.png", &found), "{size}: {found:?}");
    }
    // `auto` and `100%` leave the offsets to stretch it, and a cap at or
    // past the box (`100%`, `none`, the initial value) shrinks nothing.
    for size in [
        "width: auto; height: auto",
        "width: 100%; height: 100%",
        "max-width: none",
        "max-width: 100%; max-height: 100%",
        "max-width: initial",
    ] {
        let css = format!(".hero {{ background: url(light.png); position: relative; }} .hero::before {{ content: ''; position: absolute; inset: 0; {size}; background: rgba(0, 0, 0, 0.6); }} p {{ position: relative; color: #fdfdfd; }}");
        let found = site.contrast(&css, body);
        assert!(found.is_empty(), "{size}: {found:?}");
    }
}

#[test]
fn a_pseudo_var_reads_the_elements_own_custom_properties() {
    let site = Site::new("pseudo-var-scope");
    let pseudo = ".hero { background: url(light.png); position: relative; } .hero::before { content: ''; position: absolute; inset: 0; background: var(--scrim); } p { position: relative; color: #fdfdfd; }";
    // The element's own value, not the sheet's first declaration, is the
    // pseudo's: a dark scrim set on `.hero` under a transparent root is an
    // overlay.
    let css = format!(":root {{ --scrim: transparent; }} .hero {{ --scrim: rgba(0, 0, 0, 0.7); }} {pseudo}");
    let found = site.contrast(&css, "<div class=hero><p>White copy</p></div>");
    assert!(found.is_empty(), "{found:?}");
    // And a transparent scrim set on the element under a dark root is not.
    let css = format!(":root {{ --scrim: rgba(0, 0, 0, 0.7); }} .plain {{ --scrim: transparent; }} {pseudo}");
    let found = site.contrast(&css, "<div class=\"hero plain\"><p>White copy</p></div>");
    assert!(sampled_on("light.png", &found), "{found:?}");
    // The value inherits from an ancestor, and an inline style sets it too.
    let css = format!(":root {{ --scrim: transparent; }} .page {{ --scrim: rgba(0, 0, 0, 0.7); }} {pseudo}");
    let found = site.contrast(&css, "<div class=page><div class=hero><p>White copy</p></div></div>");
    assert!(found.is_empty(), "{found:?}");
    let css = format!(":root {{ --scrim: transparent; }} {pseudo}");
    let found = site.contrast(&css, "<div class=hero style=\"--scrim: rgba(0, 0, 0, 0.7)\"><p>White copy</p></div>");
    assert!(found.is_empty(), "{found:?}");
}

#[test]
fn a_boxless_wrapper_at_a_hidden_opacity_does_not_hide_the_text() {
    let site = Site::new("boxless-hidden");
    // A `display: contents` wrapper has no box for its opacity to apply to,
    // so its `opacity: 1%` neither fades the text nor hides it from the
    // measurement: white on the light image still fails.
    for opacity in ["1%", "0.01", "0"] {
        let css = format!(".hero {{ background: url(light.png); }} .wrap {{ display: contents; opacity: {opacity}; }} p {{ color: #fdfdfd; }}");
        let found = site.contrast(&css, "<div class=hero><div class=wrap><p>White copy</p></div></div>");
        assert!(sampled_on("light.png", &found), "{opacity}: {found:?}");
    }
    // A wrapper with a box at that opacity hides the text on purpose.
    let css = ".hero { background: url(light.png); } .wrap { opacity: 1%; } p { color: #fdfdfd; }";
    let found = site.contrast(css, "<div class=hero><div class=wrap><p>White copy</p></div></div>");
    assert!(found.is_empty(), "{found:?}");
    // The analytic fold reads past the boxless wrapper the same way: white
    // in a half-black card over a dark section is readable, whatever
    // opacity the wrapper declares.
    for opacity in ["0", "0.5", "1%"] {
        let css = format!(".section {{ background: #17150f; }} .wrap {{ display: contents; opacity: {opacity}; }} .card {{ background: rgba(0, 0, 0, 0.5); }} p {{ color: #fdfdfd; }}");
        let found = site.contrast(&css, "<div class=section><div class=wrap><div class=card><p>White copy</p></div></div></div>");
        assert!(found.is_empty(), "{opacity}: {found:?}");
    }
}

#[test]
fn an_inset_held_in_a_custom_property_is_read_once_resolved() {
    let site = Site::new("inset-var");
    let body = "<div class=hero><p>White copy</p></div>";
    // The shorthand is split into its sides only once the property has
    // resolved, so `0 0` and `0` both stretch the pseudo over the host.
    for edges in ["0 0", "0", "0 0 0 0"] {
        let css = format!(":root {{ --edges: {edges}; }} .hero {{ background: url(light.png); position: relative; }} .hero::before {{ content: ''; position: absolute; inset: var(--edges); background: rgba(0, 0, 0, 0.7); }} p {{ position: relative; color: #fdfdfd; }}");
        let found = site.contrast(&css, body);
        assert!(found.is_empty(), "{edges}: {found:?}");
    }
    // The property may be the element's own.
    let css = ".hero { --edges: 0 0; background: url(light.png); position: relative; } .hero::before { content: ''; position: absolute; inset: var(--edges); background: rgba(0, 0, 0, 0.7); } p { position: relative; color: #fdfdfd; }";
    let found = site.contrast(css, body);
    assert!(found.is_empty(), "{found:?}");
    // A bottom offset held in the property keeps it off the box, and a
    // later side still wins over the resolved shorthand.
    let css = ":root { --edges: 0 0 200px; } .hero { background: url(light.png); position: relative; } .hero::before { content: ''; position: absolute; inset: var(--edges); background: rgba(0, 0, 0, 0.7); } p { position: relative; color: #fdfdfd; }";
    let found = site.contrast(css, body);
    assert!(sampled_on("light.png", &found), "{found:?}");
    let css = ":root { --edges: 0 0; } .hero { background: url(light.png); position: relative; } .hero::before { content: ''; position: absolute; inset: var(--edges); background: rgba(0, 0, 0, 0.7); } .hero::before { top: 200px; } p { position: relative; color: #fdfdfd; }";
    let found = site.contrast(css, body);
    assert!(sampled_on("light.png", &found), "{found:?}");
}

#[test]
fn a_custom_property_the_pseudo_declares_sets_its_own_inset() {
    let site = Site::new("inset-own-var");
    let body = "<div class=hero><p>White copy</p></div>";
    let p = " p { position: relative; color: #fdfdfd; }";
    // A property declared on the pseudo's own rule is read there, over the
    // element's, which the pseudo-element inherits.
    for (host, own) in [("", "0 0"), ("--edges: 0 0 200px;", "0")] {
        let css = format!(".hero {{ {host} background: url(light.png); position: relative; }} .hero::before {{ --edges: {own}; content: ''; position: absolute; inset: var(--edges); background: rgba(0, 0, 0, 0.7); }}{p}");
        let found = site.contrast(&css, body);
        assert!(found.is_empty(), "{host} / {own}: {found:?}");
    }
    // One that references the element's resolves through it.
    let css = format!(".hero {{ --gap: 0; background: url(light.png); position: relative; }} .hero::before {{ --edges: var(--gap) var(--gap); content: ''; position: absolute; inset: var(--edges); background: rgba(0, 0, 0, 0.7); }}{p}");
    let found = site.contrast(&css, body);
    assert!(found.is_empty(), "{found:?}");
    // The pseudo's own value wins even when it keeps the box off the host.
    let css = format!(".hero {{ --edges: 0; background: url(light.png); position: relative; }} .hero::before {{ --edges: 0 0 200px; content: ''; position: absolute; inset: var(--edges); background: rgba(0, 0, 0, 0.7); }}{p}");
    let found = site.contrast(&css, body);
    assert!(sampled_on("light.png", &found), "{found:?}");
}

#[test]
fn a_custom_property_only_rule_on_another_selector_sets_the_pseudos_paint() {
    let site = Site::new("pseudo-var-other-selector");
    let body = "<div class=\"hero dark\"><p>White copy</p></div>";
    let p = " p { position: relative; color: #fdfdfd; }";
    // A rule on another selector naming only custom properties reaches the
    // merge where it matches: the dark scrim it sets is what paints.
    let css = format!(".hero {{ --scrim: transparent; background: url(light.png); position: relative; }} .hero::before {{ content: ''; position: absolute; inset: 0; background: var(--scrim); }} .dark::before {{ --scrim: rgba(0, 0, 0, 0.7); }}{p}");
    let found = site.contrast(&css, body);
    assert!(found.is_empty(), "{found:?}");
    // One that takes the paint away counts the same way.
    let css = format!(".hero {{ --scrim: rgba(0, 0, 0, 0.7); background: url(light.png); position: relative; }} .hero::before {{ content: ''; position: absolute; inset: 0; background: var(--scrim); }} .dark::before {{ --scrim: transparent; }}{p}");
    let found = site.contrast(&css, body);
    assert!(sampled_on("light.png", &found), "{found:?}");
    // One on a selector the element does not match is not read.
    let css = format!(".hero {{ --scrim: transparent; background: url(light.png); position: relative; }} .hero::before {{ content: ''; position: absolute; inset: 0; background: var(--scrim); }} .other::before {{ --scrim: rgba(0, 0, 0, 0.7); }}{p}");
    let found = site.contrast(&css, body);
    assert!(sampled_on("light.png", &found), "{found:?}");
}

#[test]
fn the_pseudos_custom_properties_resolve_against_each_other_whatever_the_order() {
    let site = Site::new("pseudo-var-order");
    let body = "<div class=hero><p>White copy</p></div>";
    let p = " p { position: relative; color: #fdfdfd; }";
    // A `var()` in one of the pseudo's own custom properties reads the
    // pseudo's own value of the other, declared before or after it, over
    // the one the element would hand down.
    for own in [
        "--scrim: var(--tone); --tone: rgba(0, 0, 0, 0.7);",
        "--tone: rgba(0, 0, 0, 0.7); --scrim: var(--tone);",
    ] {
        let css = format!(".hero {{ --tone: transparent; background: url(light.png); position: relative; }} .hero::before {{ content: ''; position: absolute; inset: 0; {own} background: var(--scrim); }}{p}");
        let found = site.contrast(&css, body);
        assert!(found.is_empty(), "{own}: {found:?}");
    }
}

#[test]
fn a_reset_on_the_pseudo_takes_the_elements_value_or_paints_nothing() {
    let site = Site::new("pseudo-var-reset");
    let body = "<div class=\"hero plain\"><p>White copy</p></div>";
    let p = " p { position: relative; color: #fdfdfd; }";
    // A custom property the pseudo sets to a CSS-wide keyword other than
    // `initial` takes the element's value (custom properties inherit), over
    // the pseudo's own earlier value: the element's transparent scrim
    // paints nothing.
    for reset in ["unset", "inherit", "revert", "revert-layer", "UNSET"] {
        let css = format!(".hero {{ --scrim: transparent; background: url(light.png); position: relative; }} .hero::before {{ content: ''; position: absolute; inset: 0; --scrim: rgba(0, 0, 0, 0.7); background: var(--scrim); }} .plain::before {{ --scrim: {reset}; }}{p}");
        let found = site.contrast(&css, body);
        assert!(sampled_on("light.png", &found), "{reset}: {found:?}");
    }
    // `initial` is the guaranteed-invalid value: a `var()` with a fallback
    // takes the fallback.
    let css = format!(".hero {{ --scrim: rgba(0, 0, 0, 0.7); background: url(light.png); position: relative; }} .hero::before {{ content: ''; position: absolute; inset: 0; background: var(--scrim, transparent); }} .plain::before {{ --scrim: initial; }}{p}");
    let found = site.contrast(&css, body);
    assert!(sampled_on("light.png", &found), "{found:?}");
    // One without a fallback leaves its declaration invalid, and the
    // property takes its initial value: the paint it carried is gone.
    let css = format!(".hero {{ --scrim: rgba(0, 0, 0, 0.7); background: url(light.png); position: relative; }} .hero::before {{ content: ''; position: absolute; inset: 0; background: var(--scrim); }} .plain::before {{ --scrim: initial; }}{p}");
    let found = site.contrast(&css, body);
    assert!(sampled_on("light.png", &found), "{found:?}");
    // A reset of the paint itself paints nothing.
    for reset in ["unset", "initial"] {
        let css = format!(".hero {{ background: url(light.png); position: relative; }} .hero::before {{ content: ''; position: absolute; inset: 0; background: rgba(0, 0, 0, 0.7); }} .plain::before {{ background: {reset}; }}{p}");
        let found = site.contrast(&css, body);
        assert!(sampled_on("light.png", &found), "{reset}: {found:?}");
    }
}

#[test]
fn a_mixed_case_custom_property_on_the_pseudo_keeps_its_spelling() {
    let site = Site::new("pseudo-var-case");
    let body = "<div class=hero><p>White copy</p></div>";
    let p = " p { position: relative; color: #fdfdfd; }";
    // Custom property names are case-sensitive: `--Scrim` is not `--scrim`,
    // so the pseudo's own value is found and the fallback is not taken.
    let css = format!(".hero {{ background: url(light.png); position: relative; }} .hero::before {{ --Scrim: transparent; content: ''; position: absolute; inset: 0; background: var(--Scrim, rgba(0, 0, 0, 0.7)); }}{p}");
    let found = site.contrast(&css, body);
    assert!(sampled_on("light.png", &found), "{found:?}");
    let css = format!(".hero {{ background: url(light.png); position: relative; }} .hero::before {{ --Scrim: rgba(0, 0, 0, 0.7); content: ''; position: absolute; inset: 0; background: var(--Scrim, transparent); }}{p}");
    let found = site.contrast(&css, body);
    assert!(found.is_empty(), "{found:?}");
    // The element's own custom properties are the cascade's, keyed
    // lowercased, so a mixed-case name is found only where the pseudo
    // declares it; on the element it misses and the fallback is taken.
}

#[test]
fn a_position_function_the_parser_cannot_read_leaves_the_image_unknown() {
    let site = Site::new("position-function");
    let body = "<div class=hero><p>White copy</p></div>";
    // A position the parser cannot read (`round()`, `clamp()`) can shift
    // the image off the box and expose the fallback colour above it, so the
    // layer is not known to cover: the analytic pair (white on #111) stands
    // and nothing is sampled.
    for shifted in [
        "0 round(nearest, 200px, 1px)",
        "0 clamp(0px, 10vh, 200px)",
        "round(nearest, 200px, 1px) 0",
    ] {
        let css = format!(".hero {{ background: #111 url(light.png) {shifted} / 100% 100% no-repeat; }} p {{ color: #fdfdfd; }}");
        let found = site.contrast(&css, body);
        assert!(found.is_empty(), "{shifted}: {found:?}");
    }
    // One the parser reads keeps covering.
    let css = ".hero { background: #111 url(light.png) 0 0 / 100% 100% no-repeat; } p { color: #fdfdfd; }";
    let found = site.contrast(css, body);
    assert!(sampled_on("light.png", &found), "{found:?}");
}

#[test]
fn a_paint_function_the_engine_does_not_know_still_counts_as_paint() {
    let site = Site::new("unknown-paint-function");
    let body = "<div class=hero><p>White copy</p></div>";
    let p = " p { position: relative; color: #fdfdfd; }";
    // A function that is neither an image call the grammar names, a colour,
    // nor a math function is paint the engine cannot read, not geometry: a
    // legacy gradient on the stretched pseudo keeps its overlay.
    for paint in [
        "-webkit-gradient(linear, left top, left bottom, from(rgba(0, 0, 0, 0.7)), to(rgba(0, 0, 0, 0.7)))",
        "-webkit-linear-gradient(top, rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.7))",
        "-webkit-canvas(scrim)",
    ] {
        let css = format!(".hero {{ background: url(light.png); position: relative; }} .hero::before {{ content: ''; position: absolute; inset: 0; background: {paint}; }}{p}");
        let found = site.contrast(&css, body);
        assert!(found.is_empty(), "{paint}: {found:?}");
    }
}
