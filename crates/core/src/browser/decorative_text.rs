//! The browser engines' reading of [`DecorativeTextFacts`] off the `Dom`
//! probe. The decision is [`classify_decorative_text`]; this only measures.

use crate::checks::decorative_text::{
    avatar_sized, centred_in, classify_decorative_text, is_mockup_marker, is_signature_marker,
    is_wordmark_size, DecorativeShape, DecorativeTextFacts, GHOST_MAX_RATIO, MOCKUP_MARKER_SKIP_TAGS, WORDMARK_H1_PATH_MIN_PX, WORDMARK_MAX_OPACITY,
    WORDMARK_MIN_PX,
};
use super::dom::{class_attr, closest_or_none, pf0, tag_lower, Dom, ElId};
use crate::color::{parse_any_color, parse_rgb, Rgba};
use crate::js;

fn parse_rgb_or_any(value: &str) -> Option<Rgba> {
    parse_rgb(Some(value)).or_else(|| parse_any_color(Some(value)))
}

/// Controls whose whole text is their label.
const CONTROL_SELECTOR: &str = "a, button, label, summary, select, option, [role=\"button\"], [role=\"link\"], [role=\"tab\"], [role=\"menuitem\"], [role=\"option\"], [role=\"checkbox\"], [role=\"radio\"], [role=\"switch\"]";
const HEADING_SELECTOR: &str = "h1, h2, h3, h4, h5, h6, [role=\"heading\"]";

fn collapsed_text(dom: &dyn Dom, el: ElId) -> String {
    js::trim(&dom.text_content(el))
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Whether a box paints something a letter could sit on: a fill, an image,
/// a visible border, or (for an `svg`) its own shapes.
fn box_paints(dom: &dyn Dom, el: ElId) -> bool {
    if tag_lower(dom, el) == "svg" {
        return true;
    }
    let fill = parse_rgb_or_any(&dom.style(el, "backgroundColor"));
    if fill.is_some_and(|c| c.alpha_or_one() > 0.1) {
        return true;
    }
    let image = dom.style(el, "backgroundImage");
    if !image.is_empty() && image != "none" {
        return true;
    }
    ["Top", "Right", "Bottom", "Left"].iter().all(|side| {
        pf0(&dom.style(el, &format!("border{side}Width"))) > 0.0
            && parse_rgb_or_any(&dom.style(el, &format!("border{side}Color")))
                .is_some_and(|c| c.alpha_or_one() > 0.1)
    })
}

/// The element, or its parent or grandparent, as a small painted box that
/// holds only this text, with the text centred in it.
fn in_avatar_box(dom: &dyn Dom, el: ElId, text: &str) -> bool {
    let own = dom.direct_text_rect(el).unwrap_or_else(|| dom.rect(el));
    let text_box = (own.left, own.top, own.width, own.height);
    let mut cur = Some(el);
    for _ in 0..3 {
        let Some(b) = cur else { break };
        if collapsed_text(dom, b) != text {
            break;
        }
        let r = dom.rect(b);
        if avatar_sized(r.width, r.height)
            && box_paints(dom, b)
            && centred_in(text_box, (r.left, r.top, r.width, r.height))
        {
            return true;
        }
        cur = dom.parent(b);
    }
    false
}

/// `(picture, marked)`: an HTML ancestor is `role="img"`, or an ancestor's
/// class or id names a mockup. A `figcaption` on the way up ends both.
fn marked_mockup(dom: &dyn Dom, el: ElId) -> (bool, bool) {
    // `role="img"` names an HTML subtree drawn as a picture. On an `svg` (or
    // inside one) it is how a chart, a logo or an icon is labelled, and a
    // chart's axis labels are read, so it says nothing there.
    let mut in_svg = closest_or_none(dom, el, "svg").is_some();
    let mut cur = Some(el);
    while let Some(c) = cur {
        let tag = tag_lower(dom, c);
        if tag == "figcaption" {
            return (false, false);
        }
        if !in_svg && dom.attr(c, "role").is_some_and(|r| js::trim(&r).eq_ignore_ascii_case("img")) {
            return (true, false);
        }
        if tag == "svg" {
            in_svg = false;
        }
        if !MOCKUP_MARKER_SKIP_TAGS.contains(&tag.as_str())
            && (is_mockup_marker(&class_attr(dom, c))
                || is_mockup_marker(&dom.attr(c, "id").unwrap_or_default()))
        {
            return (false, true);
        }
        cur = dom.parent(c);
    }
    (false, false)
}

/// Whether a box sits in a drawn product mockup: under an HTML `role="img"`
/// outside any `svg`, or in or itself a framed demo by its structure (r5-p26's
/// three title-bar dots, preview caption, or scaled or tilted device frame,
/// and r8-t1's frame box with a sample caption on it or beside it).
/// `nested-cards` reports an inner box here as advisory (decision
/// r6-t3-nested-cards-mockups); `text-occlusion` asks
/// [`covered_text_in_mockup_dom`]. A mockup class or id is not read: an
/// `illustration` names a feature tile's picture as often as a mockup, and
/// r4-p17 keeps such a tile failing.
pub fn box_in_mockup_dom(dom: &dyn Dom, el: ElId) -> bool {
    under_html_picture(dom, el)
        || super::text_context::in_framed_demo_dom(dom, el)
        || super::text_context::is_demo_frame_dom(dom, el)
}

/// Whether covered text sits in a drawn product mockup and is not a
/// control's: `text-occlusion` reports it as advisory (decision
/// r8-t2-occlusion-stacked-mockup). The framed-demo walk ends at a control
/// on its own; the `role="img"` path does not, so the control is asked here.
pub fn covered_text_in_mockup_dom(dom: &dyn Dom, el: ElId) -> bool {
    closest_or_none(dom, el, CONTROL_SELECTOR).is_none() && box_in_mockup_dom(dom, el)
}

/// `el` or an ancestor is an HTML element marked `role="img"`, outside any
/// `svg`; a `figcaption` on the way up ends the walk, as in [`marked_mockup`].
fn under_html_picture(dom: &dyn Dom, el: ElId) -> bool {
    let mut in_svg = closest_or_none(dom, el, "svg").is_some();
    let mut cur = Some(el);
    while let Some(c) = cur {
        let tag = tag_lower(dom, c);
        if tag == "figcaption" {
            return false;
        }
        if !in_svg && dom.attr(c, "role").is_some_and(|r| js::trim(&r).eq_ignore_ascii_case("img")) {
            return true;
        }
        if tag == "svg" {
            in_svg = false;
        }
        cur = dom.parent(c);
    }
    false
}

fn marked_signature(dom: &dyn Dom, el: ElId) -> bool {
    [Some(el), dom.parent(el)].into_iter().flatten().any(|c| {
        is_signature_marker(&class_attr(dom, c))
            || is_signature_marker(&dom.attr(c, "id").unwrap_or_default())
    })
}

/// How much of its ink `el` shows once it settles: its effective opacity as
/// the paint gates count it (a box a scroll timeline or a timed entrance
/// holds at 0 at its end frame, [`super::painted::effective_opacity_scrolled`])
/// times its colour's alpha. A heading caught mid-entrance is not a faint
/// wordmark. A colour that does not parse counts as opaque.
fn shown_opacity(dom: &dyn Dom, el: ElId) -> f64 {
    let ink = parse_rgb_or_any(&dom.style(el, "color")).map_or(1.0, |c| c.alpha_or_one());
    // A heading whose opacity is moving toward an end the capture cannot
    // read, or that a paused loop holds part way, is not known to be faint.
    super::painted::settled_opacity(dom, el).unwrap_or(1.0) * ink
}

/// The names the site goes by: its host name run together and without its
/// top-level label (`screen.movie` gives `screenmovie` and `screen`), and
/// its `og:site_name` or `application-name`. Where neither meta names it,
/// the title: whole when it has one part, and otherwise only the parts
/// between separators that the host name holds (`Incredible · AI that does
/// tasks` on incredible.ai gives `Incredible`). The other parts name a page
/// or a section (`Pricing | Acme`), and a faint display heading that
/// repeats one is not the site's wordmark.
fn site_names(dom: &dyn Dom) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    let host = js::to_lower_case(&dom.hostname());
    let host = host.strip_prefix("www.").unwrap_or(&host);
    let labels: Vec<&str> = host.split('.').filter(|l| !l.is_empty()).collect();
    if !labels.is_empty() {
        names.push(labels.concat());
        if labels.len() > 1 {
            names.push(labels[..labels.len() - 1].concat());
        }
    }
    let mut declared = false;
    for selector in ["meta[property=\"og:site_name\"]", "meta[name=\"application-name\"]"] {
        for meta in dom.query_all(None, selector).unwrap_or_default() {
            if let Some(content) = dom.attr(meta, "content").filter(|c| !js::trim(c).is_empty()) {
                names.push(content);
                declared = true;
            }
        }
    }
    if declared {
        return names;
    }
    if let Some(title) = dom.query_one(None, "title").ok().flatten() {
        let title = collapsed_text(dom, title);
        // A hyphen joins words (`e-commerce`) and separates nothing here.
        let parts: Vec<String> = title
            .split(['|', '·', '•', '—', '–', ':'])
            .map(|part| js::trim(part).to_string())
            .filter(|part| !part.is_empty())
            .collect();
        if parts.len() > 1 {
            let run = |text: &str| -> String {
                text.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
            };
            // The host read the same way, without its top-level label:
            // `get-acme-studio.com` holds `Acme Studio`, and a part that only
            // repeats the TLD (`Studio` on acme.studio) names nothing.
            let site_labels = if labels.len() > 1 { &labels[..labels.len() - 1] } else { &labels[..] };
            let host_run = run(&site_labels.concat());
            for part in parts {
                let joined = run(&part);
                if joined.chars().count() >= 3 && host_run.contains(&joined) {
                    names.push(part);
                }
            }
        } else {
            names.push(title);
        }
    }
    names
}

/// What the `Dom` says about one element's text.
pub fn decorative_text_facts_dom(dom: &dyn Dom, el: ElId) -> DecorativeTextFacts {
    let text = collapsed_text(dom, el);
    let control = closest_or_none(dom, el, CONTROL_SELECTOR);
    let control_label = control.is_some_and(|c| collapsed_text(dom, c) == text);
    let (picture_ancestor, mockup_ancestor) = marked_mockup(dom, el);
    let font_size_px = pf0(&dom.style(el, "fontSize"));
    // The page's `h1` sizes decide only type between the h1 path's floor and
    // the plain display floor; the walk over the page is skipped for the
    // rest, which is nearly every text the checks ask about.
    let largest_h1_px = if (WORDMARK_H1_PATH_MIN_PX..WORDMARK_MIN_PX).contains(&font_size_px) {
        dom.query_all(None, "h1")
            .unwrap_or_default()
            .into_iter()
            .map(|h| pf0(&dom.style(h, "fontSize")))
            .fold(0.0, f64::max)
    } else {
        0.0
    };
    let display = is_wordmark_size(font_size_px, largest_h1_px);
    let shown_opacity = if display { shown_opacity(dom, el) } else { 1.0 };
    let site_names = if display && shown_opacity <= WORDMARK_MAX_OPACITY {
        site_names(dom)
    } else {
        Vec::new()
    };
    let ghost_marked = font_size_px >= WORDMARK_MIN_PX && set_aside(dom, el);
    let names_page_heading = ghost_marked && names_page_heading(dom, el, &text);
    DecorativeTextFacts {
        font_size_px,
        largest_h1_px,
        shown_opacity,
        site_names,
        ghost_marked,
        faint_ground: false,
        names_page_heading,
        avatar_box: !text.is_empty() && text.chars().count() <= 3 && in_avatar_box(dom, el, &text),
        in_kbd: closest_or_none(dom, el, "kbd").is_some(),
        font_family: dom.style(el, "fontFamily"),
        in_heading: closest_or_none(dom, el, HEADING_SELECTOR).is_some(),
        control_label,
        in_control: control.is_some(),
        signature_marked: marked_signature(dom, el),
        mockup_ancestor,
        picture_ancestor,
        framed_demo: super::text_context::in_framed_demo_dom(dom, el),
        text,
    }
}

/// Whether the element is set aside from reading and pointing: it or a box
/// it sits in is `aria-hidden="true"`, it sets `pointer-events: none` on
/// itself (its parent takes pointer events: an overlay wrapper that passes
/// clicks through says nothing of the copy inside it), or a box it sits in
/// is laid at a negative `z-index` where that applies (a positioned box, or
/// a flex or grid item).
fn set_aside(dom: &dyn Dom, el: ElId) -> bool {
    let no_pointer = |n: ElId| js::trim(&dom.style(n, "pointerEvents")) == "none";
    if no_pointer(el) && !dom.parent(el).is_some_and(no_pointer) {
        return true;
    }
    let mut cur = Some(el);
    for _ in 0..64 {
        let Some(n) = cur else { break };
        if dom.attr(n, "aria-hidden").is_some_and(|v| js::trim(&v).eq_ignore_ascii_case("true")) {
            return true;
        }
        let z = dom.style(n, "zIndex");
        let z = js::trim(&z);
        if !z.is_empty() && z != "auto" && z.parse::<f64>().is_ok_and(|v| v < 0.0) {
            let position = dom.style(n, "position");
            let applies = !matches!(js::trim(&position), "" | "static")
                || dom.parent(n).is_some_and(|p| {
                    let display = dom.style(p, "display");
                    display.contains("flex") || display.contains("grid")
                });
            if applies {
                return true;
            }
        }
        cur = dom.parent(n);
    }
    false
}

/// The words of `text`, letters and digits only, lower-cased.
fn words_of(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_lowercase)
        .collect()
}

/// Whether `text` is the page's own heading, or part of it: its words run
/// word for word inside the text of a visually hidden heading (the sr-only
/// `h1` a page sets beside the same words drawn `aria-hidden`, "Northwind"
/// beside "Northwind Studio") or of the document title. At least three
/// letters or digits.
fn names_page_heading(dom: &dyn Dom, el: ElId, text: &str) -> bool {
    let words = words_of(text);
    if words.concat().chars().count() < 3 {
        return false;
    }
    let holds = |other: &str| {
        let theirs = words_of(other);
        theirs.windows(words.len()).any(|w| w == words.as_slice())
    };
    if let Some(title) = dom.query_one(None, "title").ok().flatten() {
        if holds(&collapsed_text(dom, title)) {
            return true;
        }
    }
    dom.query_all(None, HEADING_SELECTOR)
        .unwrap_or_default()
        .into_iter()
        .take(64)
        .filter(|&h| h != el && !dom.contains(h, el) && !dom.contains(el, h))
        .any(|h| holds(&collapsed_text(dom, h)) && super::quality::is_visually_hidden(dom, h))
}

/// [`decorative_text_shape_dom`], where the caller measured the ink against
/// its ground: `ratio` at most [`GHOST_MAX_RATIO`] counts as faint for a
/// ghost word (taste call r14-t3).
pub fn decorative_text_shape_measured_dom(dom: &dyn Dom, el: ElId, ratio: Option<f64>) -> Option<DecorativeShape> {
    let mut facts = decorative_text_facts_dom(dom, el);
    facts.faint_ground = ratio.is_some_and(|r| r.is_finite() && r <= GHOST_MAX_RATIO);
    classify_decorative_text(&facts)
}

/// The decorative shape one element's text has, if any.
pub fn decorative_text_shape_dom(dom: &dyn Dom, el: ElId) -> Option<DecorativeShape> {
    classify_decorative_text(&decorative_text_facts_dom(dom, el))
}

/// Whether one element's text has no reading job.
pub fn is_decorative_text_dom(dom: &dyn Dom, el: ElId) -> bool {
    decorative_text_shape_dom(dom, el).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::fake_dom::FakeDom;

    #[test]
    fn avatar_initial_in_a_round_tile() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let tile = d.add(Some(body), "span");
        d.add_text(tile, "JD");
        d.set_styles(tile, &[("backgroundColor", "rgb(19, 130, 232)"), ("fontFamily", "Inter")]);
        d.set_rect(tile, 0.0, 0.0, 40.0, 40.0);
        assert_eq!(decorative_text_shape_dom(&d, tile), Some(DecorativeShape::AvatarInitials));
        // The same letters as a link's whole label are the control's name.
        let mut d2 = FakeDom::new();
        let (_h, body) = d2.with_page();
        let a = d2.add(Some(body), "a");
        let tile = d2.add(Some(a), "span");
        d2.add_text(tile, "JD");
        d2.set_styles(tile, &[("backgroundColor", "rgb(19, 130, 232)")]);
        d2.set_rect(tile, 0.0, 0.0, 40.0, 40.0);
        assert_eq!(decorative_text_shape_dom(&d2, tile), None);
    }

    /// The page's `h1` sizes are read only for type the h1 path can decide:
    /// body text and plain display type skip the walk over the page.
    #[test]
    fn the_h1_walk_runs_only_where_it_decides() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let h1 = d.add(Some(body), "h1");
        d.add_text(h1, "Title");
        d.set_style(h1, "fontSize", "30px");
        let p = d.add(Some(body), "p");
        d.add_text(p, "Body copy");
        for (size, h1_read) in [("14px", 0.0), ("96px", 30.0), ("160px", 0.0)] {
            d.set_style(p, "fontSize", size);
            assert_eq!(decorative_text_facts_dom(&d, p).largest_h1_px, h1_read, "{size}");
        }
    }

    /// observations-1010 row 10 (taste call r14-t3): aproov.es's 410px "oo"
    /// in an `aria-hidden` layer at 0.055, and intel.com's 240px "效率" behind
    /// a slide, `aria-hidden` and at 1.3:1. Neither names the site.
    #[test]
    fn a_ghost_word_set_aside_and_faint_is_decorative() {
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        d.hostname = "aproov.es".into();
        let layer = d.add(Some(body), "div");
        let word = d.add(Some(layer), "div");
        d.add_text(word, "oo");
        d.set_styles(word, &[("fontSize", "410px"), ("color", "rgb(248, 239, 233)"), ("opacity", "0.055")]);
        d.set_rect(word, 0.0, 0.0, 900.0, 400.0);
        // Not set aside, it is a line like any other.
        assert_eq!(decorative_text_shape_dom(&d, word), None);
        d.set_attr(layer, "aria-hidden", "true");
        assert_eq!(decorative_text_shape_dom(&d, word), Some(DecorativeShape::GhostWord));
        d.set_attr(layer, "aria-hidden", "false");
        d.set_style(word, "pointerEvents", "none");
        assert_eq!(decorative_text_shape_dom(&d, word), Some(DecorativeShape::GhostWord));
        // Inherited from an overlay wrapper, it says nothing of the copy.
        d.set_style(layer, "pointerEvents", "none");
        assert_eq!(decorative_text_shape_dom(&d, word), None);
        d.set_style(layer, "pointerEvents", "auto");
        // Behind the page at a negative z-index, where it applies.
        d.set_style(word, "pointerEvents", "auto");
        d.set_styles(layer, &[("zIndex", "-10"), ("position", "static")]);
        assert_eq!(decorative_text_shape_dom(&d, word), None);
        d.set_style(layer, "position", "absolute");
        assert_eq!(decorative_text_shape_dom(&d, word), Some(DecorativeShape::GhostWord));
        // Shown whole, it is a ghost only where measured faint.
        d.set_style(word, "opacity", "1");
        assert_eq!(decorative_text_shape_dom(&d, word), None);
        assert_eq!(decorative_text_shape_measured_dom(&d, word, Some(1.3)), Some(DecorativeShape::GhostWord));
        assert_eq!(decorative_text_shape_measured_dom(&d, word, Some(1.6)), None);
        // The page's heading drawn aria-hidden beside an sr-only copy, or the
        // document title, keeps its warning.
        d.set_attr(layer, "aria-hidden", "true");
        let name = d.add(Some(layer), "div");
        d.add_text(name, "Northwind");
        d.set_styles(name, &[("fontSize", "140px"), ("color", "rgb(230, 230, 230)"), ("opacity", "0.2")]);
        d.set_rect(name, 0.0, 500.0, 900.0, 170.0);
        let h1 = d.add(Some(body), "h1");
        d.add_text(h1, "Northwind Studio");
        d.set_attr(h1, "class", "title");
        assert_eq!(decorative_text_shape_dom(&d, name), Some(DecorativeShape::GhostWord));
        // Clipped to nothing, as `sr-only` draws it.
        d.set_styles(h1, &[("position", "absolute"), ("clip", "rect(0px, 0px, 0px, 0px)")]);
        assert_eq!(decorative_text_shape_dom(&d, name), None);
        d.set_styles(h1, &[("position", "static"), ("clip", "auto")]);
        assert_eq!(decorative_text_shape_dom(&d, name), Some(DecorativeShape::GhostWord));
        let head = d.add(Some(html), "head");
        let title = d.add(Some(head), "title");
        d.add_text(title, "Northwind | Trade software");
        assert_eq!(decorative_text_shape_dom(&d, name), None);
        // Under 120px it is not display type.
        d.set_style(word, "fontSize", "110px");
        assert_eq!(decorative_text_shape_measured_dom(&d, word, Some(1.1)), None);
    }

    /// incredible.one (10048155): `span.br-footer-monogram`, "Incredible" at
    /// 272px in `rgba(0, 0, 0, 0.07)`, the site's `og:site_name`.
    #[test]
    fn a_faint_footer_wordmark_is_decorative() {
        let mut d = FakeDom::new();
        let (html, body) = d.with_page();
        d.hostname = "www.incredible.one".into();
        let head = d.add(Some(html), "head");
        let title = d.add(Some(head), "title");
        d.add_text(title, "Incredible · AI that does tasks on your computer");
        let h1 = d.add(Some(body), "h1");
        d.add_text(h1, "Do more with less");
        d.set_style(h1, "fontSize", "64px");
        let footer = d.add(Some(body), "footer");
        let mark = d.add(Some(footer), "span");
        d.add_text(mark, "Incredible");
        d.set_styles(mark, &[("fontSize", "272.102px"), ("color", "rgba(0, 0, 0, 0.07)")]);
        d.set_rect(mark, 42.0, 10411.0, 1173.0, 201.0);
        assert_eq!(decorative_text_shape_dom(&d, mark), Some(DecorativeShape::Wordmark));
        // The same name in ink a reader is meant to read is not.
        d.set_style(mark, "color", "rgba(0, 0, 0, 0.6)");
        assert_eq!(decorative_text_shape_dom(&d, mark), None);
        // Faded by its box rather than its colour, it is.
        d.set_style(mark, "color", "rgb(255, 255, 255)");
        d.set_style(footer, "opacity", "0.1");
        assert_eq!(decorative_text_shape_dom(&d, mark), Some(DecorativeShape::Wordmark));
        // Caught at 0 by a timed entrance that settles at 1, it is the name
        // in full ink, not a faint wordmark.
        d.keyframes.insert(
            "reveal".into(),
            vec![
                crate::browser::dom::KeyframeFrame { decls: vec![("opacity".into(), "0".into())] },
                crate::browser::dom::KeyframeFrame { decls: vec![("opacity".into(), "1".into())] },
            ],
        );
        d.keyframe_keys.insert("reveal".into(), vec!["0%".into(), "100%".into()]);
        d.set_styles(
            footer,
            &[
                ("opacity", "0"),
                ("animationName", "reveal"),
                ("animationIterationCount", "1"),
                ("animationFillMode", "forwards"),
                ("animationDirection", "normal"),
                ("animationDuration", "0.6s"),
                ("animationDelay", "1s"),
                ("animationTimeline", "auto"),
                ("animationPlayState", "running"),
                ("animationComposition", "replace"),
            ],
        );
        d.set_running_animations(footer, &["opacity"]);
        assert_eq!(decorative_text_shape_dom(&d, mark), None);
        // Review of #1044: caught at 0.2 part way through the same fade, it
        // settles at 1 and is not a wordmark either.
        d.set_style(footer, "opacity", "0.2");
        assert_eq!(decorative_text_shape_dom(&d, mark), None);
        // An opacity transition running, whose end the capture cannot read,
        // leaves where it settles unknown: not a wordmark.
        d.set_styles(footer, &[("animationName", "none"), ("transitionProperty", "opacity"), ("transitionDuration", "0.6s")]);
        assert_eq!(decorative_text_shape_dom(&d, mark), None);
        // The same footer at 0.2 with nothing moving it is a faint wordmark.
        d.set_running_animations(footer, &[]);
        assert_eq!(decorative_text_shape_dom(&d, mark), Some(DecorativeShape::Wordmark));
        d.set_styles(footer, &[("animationName", "reveal"), ("opacity", "0"), ("transitionProperty", "all"), ("transitionDuration", "0s")]);
        d.set_running_animations(footer, &["opacity"]);
        // A section name in the middle of a title is not the site's name,
        // and a hyphen separates nothing.
        d.add_text(title, " | Blog | Latest");
        let blog = d.add(Some(footer), "span");
        d.add_text(blog, "Blog");
        d.set_styles(blog, &[("fontSize", "272.102px"), ("color", "rgb(255, 255, 255)")]);
        assert_eq!(decorative_text_shape_dom(&d, blog), None);
        // Another word at the same size and opacity is not the site's name.
        let other = d.add(Some(footer), "span");
        d.add_text(other, "Tasks");
        d.set_styles(other, &[("fontSize", "272.102px"), ("color", "rgb(255, 255, 255)")]);
        assert_eq!(decorative_text_shape_dom(&d, other), None);
    }

    /// #1076: a faint display heading that repeats the page's part of the
    /// title (a 120px "Pricing" on "Pricing | Acme") is a page name, not
    /// the site's wordmark. Only the part the host name or an explicit
    /// site name corroborates names the site.
    #[test]
    fn a_title_part_names_the_site_only_where_something_backs_it() {
        let build = |host: &str, site_name: Option<&str>, title_text: &str, text: &str| {
            let mut d = FakeDom::new();
            let (html, body) = d.with_page();
            d.hostname = host.into();
            let head = d.add(Some(html), "head");
            let title = d.add(Some(head), "title");
            d.add_text(title, title_text);
            if let Some(name) = site_name {
                let meta = d.add(Some(head), "meta");
                d.add_selector(meta, "meta[property=\"og:site_name\"]");
                d.set_attr(meta, "property", "og:site_name");
                d.set_attr(meta, "content", name);
            }
            let mark = d.add(Some(body), "span");
            d.add_text(mark, text);
            d.set_styles(mark, &[("fontSize", "160px"), ("color", "rgba(0, 0, 0, 0.1)")]);
            d.set_rect(mark, 0.0, 400.0, 900.0, 160.0);
            decorative_text_shape_dom(&d, mark)
        };
        let wordmark = Some(DecorativeShape::Wordmark);
        assert_eq!(build("", None, "Pricing | Acme", "Pricing"), None);
        assert_eq!(build("", None, "Pricing | Acme", "Acme"), None, "nothing backs either part");
        assert_eq!(build("getacme.io", None, "Pricing | Acme", "Acme"), wordmark);
        assert_eq!(build("getacme.io", None, "Pricing | Acme", "Pricing"), None);
        assert_eq!(build("get-acme-studio.com", None, "Pricing | Acme Studio", "Acme Studio"), wordmark);
        assert_eq!(build("acme.studio", None, "Pricing | Studio", "Studio"), None);
        assert_eq!(build("www.acme.io", None, "Acme | io", "io"), None);
        assert_eq!(build("www.acme.io", None, "Acme | io", "Acme"), wordmark);
        assert_eq!(build("", Some("Acme"), "Pricing | Acme", "Acme"), wordmark);
        assert_eq!(build("", Some("Acme"), "Pricing | Acme", "Pricing"), None);
        // A title of one part is the site's name, opened word for word.
        assert_eq!(build("", None, "Screen Movie Blog", "Screen Movie"), wordmark);
    }

    #[test]
    fn a_key_or_an_info_badge_is_not_initials() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let p = d.add(Some(body), "p");
        let key = d.add(Some(p), "kbd");
        d.add_text(key, "K");
        d.set_styles(key, &[("backgroundColor", "rgb(246, 246, 246)")]);
        d.set_rect(key, 0.0, 0.0, 20.0, 20.0);
        assert_eq!(decorative_text_shape_dom(&d, key), None);
        let info = d.add(Some(body), "span");
        d.add_text(info, "i");
        d.set_styles(info, &[("backgroundColor", "rgb(242, 242, 242)")]);
        d.set_rect(info, 0.0, 40.0, 16.0, 16.0);
        assert_eq!(decorative_text_shape_dom(&d, info), None);
        // A brand's lower-case letter in a chat avatar is an avatar.
        let brand = d.add(Some(body), "span");
        d.add_text(brand, "r");
        d.set_styles(brand, &[("backgroundColor", "rgb(19, 130, 232)")]);
        d.set_rect(brand, 0.0, 80.0, 28.0, 28.0);
        assert_eq!(decorative_text_shape_dom(&d, brand), Some(DecorativeShape::AvatarInitials));
    }

    #[test]
    fn a_letter_in_an_unpainted_or_wide_box_is_text() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let bare = d.add(Some(body), "span");
        d.add_text(bare, "A");
        d.set_rect(bare, 0.0, 0.0, 40.0, 40.0);
        assert_eq!(decorative_text_shape_dom(&d, bare), None);
        let wide = d.add(Some(body), "span");
        d.add_text(wide, "A");
        d.set_styles(wide, &[("backgroundColor", "rgb(0, 0, 0)")]);
        d.set_rect(wide, 0.0, 0.0, 120.0, 40.0);
        assert_eq!(decorative_text_shape_dom(&d, wide), None);
    }

    #[test]
    fn mockup_marker_reaches_through_ancestors_but_not_sections() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let frame = d.add(Some(body), "div");
        d.set_attr(frame, "class", "hero-mockup");
        let row = d.add(Some(frame), "div");
        let label = d.add(Some(row), "span");
        d.add_text(label, "Ready");
        assert_eq!(decorative_text_shape_dom(&d, label), Some(DecorativeShape::Mockup));
        let sec = d.add(Some(body), "section");
        d.set_attr(sec, "class", "mockups");
        let p = d.add(Some(sec), "p");
        d.add_text(p, "Every mockup ships with source files");
        assert_eq!(decorative_text_shape_dom(&d, p), None);
        // A practice exam and an image credit are not pictures of a UI.
        for class in ["mock-exam", "illustration-credit"] {
            let wrap = d.add(Some(body), "div");
            d.set_attr(wrap, "class", class);
            let q = d.add(Some(wrap), "p");
            d.add_text(q, "Short label");
            assert_eq!(decorative_text_shape_dom(&d, q), None, "{class}");
        }
    }

    #[test]
    fn role_img_marks_html_pictures_not_svg_charts() {
        let mut d = FakeDom::new();
        let (_h, body) = d.with_page();
        let pic = d.add(Some(body), "div");
        d.set_attr(pic, "role", "img");
        let code = d.add(Some(pic), "code");
        d.add_text(code, "$ npm run build");
        assert_eq!(decorative_text_shape_dom(&d, code), Some(DecorativeShape::Mockup));
        let chart = d.add(Some(body), "svg");
        d.set_attr(chart, "role", "img");
        let label = d.add(Some(chart), "text");
        d.add_text(label, "Nov 2022");
        assert_eq!(decorative_text_shape_dom(&d, label), None);
    }
}
