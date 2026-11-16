//! Contexts in which a typography finding reports as advisory rather than as
//! a failure (premise round 4, three taste calls Paul decided on 2026-10-01,
//! all "advisory"). The finding stays in the output with its snippet byte
//! for byte; only its severity moves, and only inside the context.
//!
//! - **r5-p26, framed HTML demos** ([`in_framed_demo`]): "Read mock context
//!   from structure as well as from a class: a window with three title-bar
//!   dots, a caption with the word preview, a device frame that is scaled or
//!   3D-transformed. [...] Sentence-length copy inside still counts as
//!   copy." It feeds the `Mockup` shape of
//!   [`crate::checks::decorative_text`], so `low-contrast` picks it up, and
//!   `undersized-ui-text` and `tiny-text` read the same shape. Decision
//!   r8-t1-mockups-by-caption (2026-10-07, "narrow") adds a frame with no
//!   chrome at all that a sample caption names: "A panel with a sample or
//!   illustrative caption on it or beside it is mock context."
//! - **r5-p27, legal fine print** ([`is_fine_print`]): "Report text marked
//!   as fine print (a legal, disclaimer, terms or footnote class, or a block
//!   that opens with an asterisk or a footnote mark) as advisory under the
//!   three rules. A consent or form label is not fine print and keeps
//!   failing." The rules are `line-length`, `tiny-text` and `tight-leading`.
//!   Decision 3 of round 13 (2026-10-22) moves part of it from advisory to
//!   exempt: "Legal/footnote blocks are exempt from line-length and
//!   tiny-text; links inside them keep undersized-ui-text." [`fine_print`]
//!   tells the two tiers apart: a block under a legal or footnote marker
//!   reports nothing under those two rules and stays advisory under
//!   `tight-leading`.
//! - **r5-p3, micro-labels** ([`is_micro_label`]): "Report text under the
//!   floor as advisory when it is a label with no reading job: a tick or
//!   axis label inside a chart, a unit or step marker beside a number, a
//!   pill or eyebrow of a few words beside a heading. Prices, form help,
//!   navigation and controls keep failing." The rule is
//!   `undersized-ui-text`.
//!
//! Every predicate asks for positive evidence on the DOM and answers `false`
//! where a fact is missing, so an engine that cannot measure (the static
//! engine has no layout) keeps the finding at its own severity.
//!
//! Both engines read their DOM through [`ContextNode`]; the decisions are
//! made here once.

use once_cell::sync::Lazy;
use regex::Regex;

use crate::checks::decorative_text::{is_sentence_copy, token_parts};
use crate::color::{parse_any_color, parse_rgb};

/// What a context predicate reads off one element. `rect` is the rendered
/// box `(left, top, width, height)`, `None` where the engine has no layout;
/// `size` is the rendered size, or the declared `width` and `height` in px
/// where that is all the engine has.
pub trait ContextNode: Clone {
    /// A value equal for the same element and for no other.
    fn key(&self) -> u64;
    /// The tag name, lower case.
    fn tag(&self) -> String;
    fn class_list(&self) -> String;
    fn id_attr(&self) -> String;
    fn attr(&self, name: &str) -> Option<String>;
    fn parent(&self) -> Option<Self>;
    /// Element children, in order.
    fn children(&self) -> Vec<Self>;
    /// `textContent`.
    fn text(&self) -> String;
    /// The element's own text nodes, joined.
    fn direct_text(&self) -> String;
    /// A style value by its camel-case name; `""` when unknown.
    fn style(&self, prop: &str) -> String;
    /// The font size in px.
    fn font_size(&self) -> f64;
    fn rect(&self) -> Option<(f64, f64, f64, f64)>;
    fn size(&self) -> Option<(f64, f64)> {
        self.rect().map(|(_, _, w, h)| (w, h))
    }
    /// An animation or transition is moving this element's transform right
    /// now, so the transform read off it is a frame, not a resting state.
    fn transform_running(&self) -> bool {
        false
    }
}

fn collapse(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn word_count(s: &str) -> usize {
    s.split_whitespace().count()
}

fn px(value: &str) -> Option<f64> {
    let n: f64 = value.trim().strip_suffix("px")?.trim().parse().ok()?;
    n.is_finite().then_some(n)
}

fn colour_alpha(value: &str) -> f64 {
    parse_rgb(Some(value))
        .or_else(|| parse_any_color(Some(value)))
        .map_or(0.0, |c| c.alpha_or_one())
}

fn has_shadow(n: &impl ContextNode) -> bool {
    let s = n.style("boxShadow");
    !s.is_empty() && s != "none"
}

fn has_border(n: &impl ContextNode) -> bool {
    ["Top", "Right", "Bottom", "Left"].iter().all(|side| {
        px(&n.style(&format!("border{side}Width"))).is_some_and(|w| w > 0.0)
            && colour_alpha(&n.style(&format!("border{side}Color"))) > 0.1
    })
}

/// The first corner radius of a `border-radius` value, in px against a box
/// of `side` px.
fn radius_px(value: &str, side: f64) -> f64 {
    let first = value.split_whitespace().next().unwrap_or("");
    if let Some(p) = first.strip_suffix('%') {
        return p.parse::<f64>().map_or(0.0, |p| side * p / 100.0);
    }
    px(first).unwrap_or(0.0)
}

fn is_rounded(n: &impl ContextNode) -> bool {
    radius_px(&n.style("borderRadius"), 100.0) > 0.0
}

/// A box drawn as a frame: rounded corners, and a border or a shadow.
fn is_frame_box(n: &impl ContextNode) -> bool {
    is_rounded(n) && (has_shadow(n) || has_border(n))
}

fn has_part(class_or_id: &str, set: &[&str]) -> bool {
    class_or_id
        .split_whitespace()
        .any(|token| token_parts(token).iter().any(|p| set.contains(&p.as_str())))
}

fn is_heading(n: &impl ContextNode) -> bool {
    matches!(n.tag().as_str(), "h1" | "h2" | "h3" | "h4" | "h5" | "h6")
        || n.attr("role").is_some_and(|r| r.trim().eq_ignore_ascii_case("heading"))
}

fn siblings<N: ContextNode>(n: &N) -> (Option<N>, Option<N>, Vec<N>) {
    let Some(parent) = n.parent() else { return (None, None, Vec::new()) };
    let all = parent.children();
    let Some(i) = all.iter().position(|c| c.key() == n.key()) else {
        return (None, None, all);
    };
    let prev = i.checked_sub(1).and_then(|j| all.get(j).cloned());
    let next = all.get(i + 1).cloned();
    (prev, next, all)
}

// ─── r5-p26: framed HTML demos ──────────────────────────────────────────────

/// What a `transform` value does to the box, read from the computed matrix
/// or from the functions as declared.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct TransformRead {
    /// The box is tilted out of the page plane (`rotateX`, `rotateY`), by
    /// more than about one degree and not flipped flat on its back.
    pub tilt_3d: bool,
    /// The box is scaled by one factor on both axes, rotated in the page
    /// plane or not.
    pub uniform_scale: Option<f64>,
    /// The box's turn in the page plane, in radians (`rotate()`, or a
    /// matrix that turns without skewing); 0 when it is not turned, or when
    /// a skew or a 3D transform leaves the turn unread.
    pub turn_rad: f64,
}

/// The sine of a tilt that counts: about 1.15 degrees. outreign.io's demo
/// window is tilted 2 degrees, vestris.ai's 3.7.
pub const TILT_MIN_SIN: f64 = 0.02;
/// The largest scale that reads as a shrunken device frame. Tailwind's
/// `scale-90` and `scale-95` on a resting card are layout, not a picture;
/// coachcall.ai's demo cards sit at 0.7 and 0.75.
pub const FRAME_SCALE_MAX: f64 = 0.85;
/// The sine of an in-plane rotation that turns a scaled frame into a
/// picture of one: 3 degrees. suitemigration.com's hero deck turns its
/// `app-screen` cards 12 degrees at a scale of 0.78.
pub const ROTATION_MIN_SIN: f64 = 0.052;
/// Below this the box is mid-reveal or hidden, not a frame.
pub const FRAME_SCALE_MIN: f64 = 0.3;
/// The smallest rendered box, in px, that can be a demo frame.
pub const FRAME_MIN_WIDTH_PX: f64 = 120.0;
pub const FRAME_MIN_HEIGHT_PX: f64 = 80.0;

static TRANSFORM_FN_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)([a-z0-9]+)\(([^()]*)\)").expect("TRANSFORM_FN_RE"));

fn numbers(args: &str) -> Vec<f64> {
    args.split(',')
        .flat_map(|p| p.split_whitespace())
        .filter_map(|p| {
            let p = p.trim();
            let end = p
                .find(|c: char| !(c.is_ascii_digit() || matches!(c, '.' | '-' | '+' | 'e' | 'E')))
                .unwrap_or(p.len());
            p[..end].parse::<f64>().ok()
        })
        .collect()
}

/// The sine of an angle argument (`8deg`, `0.2rad`, `0.05turn`).
fn angle_sin(arg: &str) -> f64 {
    angle_rad(arg).map_or(0.0, f64::sin)
}

/// An angle argument in radians.
fn angle_rad(arg: &str) -> Option<f64> {
    let a = arg.trim().to_ascii_lowercase();
    let (n, to_rad) = if let Some(n) = a.strip_suffix("deg") {
        (n, std::f64::consts::PI / 180.0)
    } else if let Some(n) = a.strip_suffix("grad") {
        (n, std::f64::consts::PI / 200.0)
    } else if let Some(n) = a.strip_suffix("rad") {
        (n, 1.0)
    } else if let Some(n) = a.strip_suffix("turn") {
        (n, std::f64::consts::TAU)
    } else {
        (a.as_str(), std::f64::consts::PI / 180.0)
    };
    n.trim().parse::<f64>().ok().map(|n| n * to_rad).filter(|r| r.is_finite())
}

/// Read a `transform` value, computed (`matrix(...)`, `matrix3d(...)`) or as
/// declared (`perspective(900px) rotateX(8deg)`, `scale(0.7)`).
pub fn read_transform(value: &str) -> TransformRead {
    let mut out = TransformRead::default();
    let mut scale: Option<(f64, f64)> = None;
    let mut rotated = false;
    // The turn in the page plane, in radians, while nothing skews the box.
    let mut angle: Option<f64> = Some(0.0);
    for c in TRANSFORM_FN_RE.captures_iter(value) {
        let name = c[1].to_ascii_lowercase();
        let n = numbers(&c[2]);
        match name.as_str() {
            "matrix" if n.len() == 6 => {
                if n[1].abs() > 0.01 || n[2].abs() > 0.01 {
                    rotated = true;
                }
                angle = plane_turn(angle, n[0], n[1], n[2], n[3]);
                let (sx, sy) = (n[0].hypot(n[1]), n[2].hypot(n[3]));
                scale = Some(scale.map_or((sx, sy), |(a, b)| (a * sx, b * sy)));
            }
            "matrix3d" if n.len() == 16 => {
                let tilt = [n[2], n[6], n[8], n[9]].iter().fold(0.0f64, |m, v| m.max(v.abs()));
                if tilt >= TILT_MIN_SIN {
                    out.tilt_3d = true;
                }
                // The browser folds a 2D scale under a 3D function
                // (`translate3d(0,0,0) scale(0.7)`) into one matrix3d; read
                // its scale the way `matrix` is read when nothing tilts it.
                if [n[2], n[6], n[8], n[9], n[11]].iter().all(|v| v.abs() <= 0.01) {
                    if n[1].abs() > 0.01 || n[4].abs() > 0.01 {
                        rotated = true;
                    }
                    angle = plane_turn(angle, n[0], n[1], n[4], n[5]);
                    let (sx, sy) = (n[0].hypot(n[1]), n[4].hypot(n[5]));
                    scale = Some(scale.map_or((sx, sy), |(a, b)| (a * sx, b * sy)));
                } else {
                    rotated = true;
                    angle = None;
                }
            }
            "rotatex" | "rotatey" => {
                if angle_sin(&c[2]).abs() >= TILT_MIN_SIN {
                    out.tilt_3d = true;
                }
            }
            "rotate3d" => {
                let parts: Vec<&str> = c[2].split(',').collect();
                if parts.len() == 4
                    && (n.first().is_some_and(|x| *x != 0.0) || n.get(1).is_some_and(|y| *y != 0.0))
                    && angle_sin(parts[3]).abs() >= TILT_MIN_SIN
                {
                    out.tilt_3d = true;
                }
            }
            "rotate" | "rotatez" | "skew" | "skewx" | "skewy" => {
                let rad = angle_rad(c[2].split(',').next().unwrap_or("")).unwrap_or(0.0);
                if rad.sin().abs() > 0.01 {
                    rotated = true;
                    angle = if name.starts_with("rotate") { angle.map(|a| a + rad) } else { None };
                }
            }
            "scale" if !n.is_empty() => {
                let (sx, sy) = (n[0], *n.get(1).unwrap_or(&n[0]));
                scale = Some(scale.map_or((sx, sy), |(a, b)| (a * sx, b * sy)));
            }
            "scale3d" if n.len() >= 2 => {
                scale = Some(scale.map_or((n[0], n[1]), |(a, b)| (a * n[0], b * n[1])));
            }
            _ => {}
        }
    }
    // A turn in the page plane keeps the scale readable; a tilt or a skew
    // does not.
    let flat_turn = if rotated { angle.filter(|_| !out.tilt_3d) } else { Some(0.0) };
    if let Some(turn) = flat_turn {
        out.turn_rad = turn;
        if let Some((sx, sy)) = scale {
            if !out.tilt_3d && (sx - sy).abs() < 0.02 {
                out.uniform_scale = Some(sx);
            }
        }
    }
    out
}

/// The turn the standalone `rotate` property gives, in radians: `10deg`,
/// or `z 10deg` / `0 0 1 10deg`. `None` for no turn in the page plane
/// (`none`, a turn about x or y, which is not read here).
fn rotate_property(value: &str) -> Option<f64> {
    let parts: Vec<&str> = value.split_whitespace().collect();
    match parts.as_slice() {
        [a] => angle_rad(a),
        [axis, a] if axis.eq_ignore_ascii_case("z") => angle_rad(a),
        [x, y, z, a] if x.parse::<f64>().ok() == Some(0.0) && y.parse::<f64>().ok() == Some(0.0) => {
            let z: f64 = z.parse().ok()?;
            angle_rad(a).map(|r| if z < 0.0 { -r } else { r })
        }
        _ => None,
    }
}

/// The sine of the box's whole turn in the page plane: `transform` and the
/// `rotate` property together.
fn turn_sin(c: &impl ContextNode, t: &TransformRead) -> f64 {
    (t.turn_rad + rotate_property(&c.style("rotate")).unwrap_or(0.0)).sin()
}

/// Add a 2D matrix's turn to `angle`, or `None` when the matrix skews
/// (its columns are not one rotation at one scale).
fn plane_turn(angle: Option<f64>, a: f64, b: f64, c: f64, d: f64) -> Option<f64> {
    let angle = angle?;
    if (b + c).abs() > 0.02 || (a - d).abs() > 0.02 {
        return None;
    }
    Some(angle + b.atan2(a))
}

/// The standalone `scale` property (`0.7`, `0.7 0.7`), when uniform.
fn scale_property(value: &str) -> Option<f64> {
    let n: Vec<f64> = value.split_whitespace().filter_map(|p| p.parse().ok()).collect();
    match n.as_slice() {
        [s] => Some(*s),
        [x, y] | [x, y, _] if (x - y).abs() < 0.02 => Some(*x),
        _ => None,
    }
}

/// A caption that says the box under it is a preview: at most three words,
/// one of them `preview` ("Simulated preview", "Live preview", "Preview").
pub fn is_preview_caption(text: &str) -> bool {
    let words: Vec<String> = text
        .split_whitespace()
        .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase())
        .filter(|w| !w.is_empty())
        .collect();
    (1..=3).contains(&words.len()) && words.iter().any(|w| w == "preview")
}

/// Words that say a panel's content is made up when a data noun follows
/// them: "Sample data" is the caption on ascenix.co and decent.com, and
/// `placeholder` is the word ascenix.co's own markup uses for the same
/// figures. Alone they name real content as often: "Sample" beside an audio
/// clip (theagenticdatacompany.com), "Example" over a worked case (tavi.pet,
/// vaultlykeep.com), "Demo" and "Mock test" on a call to action.
const SAMPLE_WORDS: &[&str] = &["sample", "example", "demo", "mock", "dummy", "placeholder"];
/// What the sample word has to be said of.
const SAMPLE_NOUNS: &[&str] = &["data", "figures", "numbers", "values"];
/// A sample caption is a label, maybe with one line of small print after
/// it ("Sample data. No real resident information appears on this site.",
/// ten words). Longer text is prose that happens to open with the word.
const SAMPLE_CAPTION_MAX_WORDS: usize = 16;
/// Tags a sample caption is read from: text boxes, never a control, a
/// heading, a table cell, a list item or code.
const SAMPLE_CAPTION_TAGS: &[&str] =
    &["p", "span", "div", "small", "em", "i", "strong", "b", "figcaption"];
/// Words that say the panel is made up: the caption cue of decision r14-t1
/// ("a caption calling it illustrative or fictional"). `illustrative` counts
/// whatever follows it, `fictional` only alone or said of data or a company.
const ILLUSTRATIVE_WORDS: &[&str] = &["illustrative", "fictional"];
/// How far above a frame a caption beside it is looked for. ascenix.co's
/// "Sample data" note closes a tab set three wrappers above each panel.
const SAMPLE_CAPTION_BESIDE_LEVELS: usize = 4;

/// A caption that says the panel it sits on or beside shows sample content:
/// its label, the text up to the first sentence end or separator, is at
/// most three words and is one of two closed English phrases. Either one of
/// the words is `illustrative` or `fictional` ("Illustrative" and "Illustrative example" on
/// getpaidlens.com, "Illustrative example" on veeza.ai, "Illustrative
/// markdown" on context.dev, "Illustrative report only" on decent.com), or
/// the label is a sample word and a data noun, with `only` after them or not
/// ("Sample data", "Example figures only", "Demo data"). Words are compared
/// whole, so "Sample", "Sample rate", "Example response", "Book a demo" and
/// a caption in another language are not one, and neither is a sentence
/// that works the word in ("An example project mid-migration.").
pub fn is_sample_caption(text: &str) -> bool {
    let all: Vec<&str> = text.split_whitespace().collect();
    if all.len() > SAMPLE_CAPTION_MAX_WORDS {
        return false;
    }
    // The label ends at the first word that closes a sentence or carries a
    // separator. A mark inside a word ("example.com/pricing") closes nothing.
    // A comma closes it only once the label holds an illustrative word:
    // usedefinite.com's "Illustrative values, shown only to explain each
    // workflow." is labelled by its first two words, while "Sample data,
    // exports and reports are kept for 30 days" is a sentence.
    const ENDS: &[char] = &['.', '!', '?', ':', ';', '。', '：'];
    const COMMAS: &[char] = &[',', '，'];
    const SEPARATORS: &[&str] = &["·", "•", "|", "—", "–", "-"];
    let mut words: Vec<String> = Vec::new();
    for raw in all {
        if SEPARATORS.contains(&raw) {
            break;
        }
        let word = raw.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase();
        if !word.is_empty() {
            words.push(word);
        }
        if raw.ends_with(ENDS)
            || (raw.ends_with(COMMAS) && words.iter().any(|w| ILLUSTRATIVE_WORDS.contains(&w.as_str())))
        {
            break;
        }
    }
    if !(1..=3).contains(&words.len()) {
        return false;
    }
    if words.iter().any(|w| w == "illustrative") {
        return true;
    }
    // `fictional` alone, or said of data or a company ("Fictional company
    // data"); "Fictional worlds, real heartbreak." is a tagline.
    if words[0] == "fictional" {
        return words.get(1).is_none_or(|w| SAMPLE_NOUNS.contains(&w.as_str()) || w == "company")
            && words.get(2).is_none_or(|w| SAMPLE_NOUNS.contains(&w.as_str()) || w == "only");
    }
    words.len() >= 2
        && SAMPLE_WORDS.contains(&words[0].as_str())
        && SAMPLE_NOUNS.contains(&words[1].as_str())
        && words.get(2).is_none_or(|w| w == "only")
}

/// The element is a sample caption: a text box of its own (no element
/// children, and no text beside it in its parent, so a bold "Example" that
/// opens a paragraph is not one), outside code, with a sample label.
fn is_sample_caption_node<N: ContextNode>(n: &N) -> bool {
    if !SAMPLE_CAPTION_TAGS.contains(&n.tag().as_str())
        || n.attr("role").is_some()
        || !n.children().is_empty()
        || !is_sample_caption(&collapse(&n.direct_text()))
    {
        return false;
    }
    let mut up = n.parent();
    for depth in 0..3 {
        let Some(p) = up else { break };
        let tag = p.tag();
        if matches!(tag.as_str(), "code" | "pre" | "kbd" | "samp" | "a" | "button" | "label" | "summary")
            || is_heading(&p)
            || p.attr("role").is_some_and(|r| DEMO_CONTROL_ROLES.contains(&r.trim().to_lowercase().as_str()))
            || (depth == 0 && !collapse(&p.direct_text()).is_empty())
        {
            return false;
        }
        up = p.parent();
    }
    true
}

/// A sample caption on the panel: in its first or its last child (or its
/// one wrapper's), which is where a header pill ("Illustrative", getpaidlens.com) and a footer note
/// ("Illustrative example. Figures shown are not customer data.") sit.
fn has_sample_caption_on<N: ContextNode>(panel: &N) -> bool {
    // A panel that holds one wrapper has its header and footer inside it.
    let mut kids = panel.children();
    for _ in 0..3 {
        if kids.len() != 1 {
            break;
        }
        kids = kids[0].children();
    }
    if kids.len() < 2 {
        return false;
    }
    [kids[0].clone(), kids[kids.len() - 1].clone()].into_iter().any(|edge| {
        let mut level = vec![edge];
        let mut visited = 0usize;
        for _ in 0..4 {
            let mut next = Vec::new();
            for n in &level {
                visited += 1;
                if visited > 40 {
                    return false;
                }
                if is_sample_caption_node(n) {
                    return true;
                }
                next.extend(n.children());
            }
            level = next;
        }
        false
    })
}

/// A sample caption beside the box: the sibling before or after it, or the
/// first or the last child of its parent. Children of the page's own shell
/// (`body`, `main`) are not beside anything.
fn has_sample_caption_beside<N: ContextNode>(c: &N) -> bool {
    let Some(parent) = c.parent() else { return false };
    if FRAME_STOP_TAGS.contains(&parent.tag().as_str()) {
        return false;
    }
    let (prev, next, all) = siblings(c);
    [prev, next, all.first().cloned(), all.last().cloned()]
        .into_iter()
        .flatten()
        .any(|s| s.key() != c.key() && is_sample_caption_node(&s))
}

/// Class or id parts that name a carousel slide. Sliders scale and tilt
/// their resting slides (a coverflow), and a slide holds real content.
const SLIDE_PARTS: &[&str] = &[
    "carousel", "embla", "flicking", "glide", "keen", "slick", "slide", "slider", "slides",
    "splide", "swiper",
];
/// Parts that name a row of dots as slider pagination, not window chrome.
const PAGINATION_PARTS: &[&str] =
    &["bullet", "bullets", "indicator", "indicators", "pager", "pagination"];
/// Tags a demo frame is never read from, and where the walk up ends.
const FRAME_STOP_TAGS: &[&str] = &["html", "body", "main"];
/// Landmarks that are never themselves a frame by scale, tilt, size or a
/// caption; the walk passes through. A window drawn on one is still read by
/// its traffic lights ([`is_traffic_light_window`]).
const FRAME_SKIP_TAGS: &[&str] = &["section", "article", "header", "footer", "nav"];
/// Controls whose text keeps its severity inside a demo frame.
const DEMO_CONTROL_TAGS: &[&str] = &["button", "select", "textarea", "input", "summary", "label"];
const DEMO_CONTROL_ROLES: &[&str] = &[
    "button", "link", "tab", "menuitem", "option", "checkbox", "radio", "switch",
];
const DOT_SKIP_TAGS: &[&str] = &["a", "button", "input", "li", "svg", "img"];
/// A title-bar dot's side, in px.
const DOT_MIN_PX: f64 = 5.0;
const DOT_MAX_PX: f64 = 16.0;
/// The shortest first child that reads as a title bar, in px, and the
/// shortest one that does when it carries a trio of dots.
const TITLE_BAR_MIN_PX: f64 = 12.0;
const TITLE_BAR_MIN_DOTS_PX: f64 = 8.0;
/// The tallest first child that still reads as a title bar, in px.
const TITLE_BAR_MAX_PX: f64 = 72.0;

fn is_dot(n: &impl ContextNode) -> bool {
    if DOT_SKIP_TAGS.contains(&n.tag().as_str())
        || !n.children().is_empty()
        || !n.text().trim().is_empty()
        || has_part(&n.class_list(), PAGINATION_PARTS)
    {
        return false;
    }
    let Some((w, h)) = n.size() else { return false };
    if !((DOT_MIN_PX..=DOT_MAX_PX).contains(&w) && (DOT_MIN_PX..=DOT_MAX_PX).contains(&h))
        || (w - h).abs() > 1.5
    {
        return false;
    }
    if radius_px(&n.style("borderRadius"), w.min(h)) < w.min(h) / 2.0 - 0.5 {
        return false;
    }
    let image = n.style("backgroundImage");
    colour_alpha(&n.style("backgroundColor")) > 0.1
        || (!image.is_empty() && image != "none")
        || has_border(n)
}

/// Exactly three dots lead this container's children, side by side.
fn leads_with_dot_trio<N: ContextNode>(container: &N) -> Option<[N; 3]> {
    let kids = container.children();
    if kids.len() < 3 || !kids[..3].iter().all(is_dot) || kids.get(3).is_some_and(is_dot) {
        return None;
    }
    if has_part(&container.class_list(), PAGINATION_PARTS) {
        return None;
    }
    let trio = [kids[0].clone(), kids[1].clone(), kids[2].clone()];
    let rects: Vec<_> = trio.iter().filter_map(|d| d.rect()).collect();
    if rects.len() == 3 {
        let same_row = rects.iter().all(|r| (r.1 - rects[0].1).abs() <= 1.5);
        let in_order = rects[0].0 < rects[1].0 && rects[1].0 < rects[2].0;
        if !same_row || !in_order {
            return None;
        }
    }
    Some(trio)
}

fn find_dot_trio<N: ContextNode>(bar: &N) -> Option<[N; 3]> {
    let mut level = vec![bar.clone()];
    let mut visited = 0usize;
    for _ in 0..3 {
        let mut next = Vec::new();
        for n in &level {
            visited += 1;
            if visited > 40 {
                return None;
            }
            if let Some(trio) = leads_with_dot_trio(n) {
                return Some(trio);
            }
            next.extend(n.children());
        }
        level = next;
    }
    None
}

fn bar_has_preview_caption<N: ContextNode>(bar: &N) -> bool {
    let mut level = vec![bar.clone()];
    let mut visited = 0usize;
    for _ in 0..4 {
        let mut next = Vec::new();
        for n in &level {
            visited += 1;
            if visited > 40 {
                return false;
            }
            let tag = n.tag();
            if matches!(tag.as_str(), "a" | "button" | "label" | "select" | "summary")
                || is_heading(n)
                || n.attr("role").is_some()
            {
                continue;
            }
            if is_preview_caption(&collapse(&n.direct_text())) {
                return true;
            }
            next.extend(n.children());
        }
        level = next;
    }
    false
}

/// A child laid over the box rather than in its flow, holding no text: an
/// `aria-hidden` or absolutely placed glow, sheen or backdrop.
/// cursorhelper.vercel.app's `.hero-window` opens with an `aria-hidden`
/// absolute glow, and its 45px dotted bar comes second. A child that carries
/// the traffic lights is the bar itself, `aria-hidden` or not.
fn is_textless_layer<N: ContextNode>(n: &N) -> bool {
    let laid_over = n.attr("aria-hidden").is_some_and(|v| v.trim().eq_ignore_ascii_case("true"))
        || matches!(n.style("position").trim(), "absolute" | "fixed");
    laid_over && n.text().trim().is_empty() && find_dot_trio(n).is_none()
}

/// How far below the box's top edge a title bar may start, in px: within
/// [`TITLE_BAR_TOP_PX`] of the edge, or at the box's own padding edge
/// (mymanagment.net's bar sits 25px down, under a 1px border and 24px of
/// padding) up to [`TITLE_BAR_TOP_MAX_PX`].
const TITLE_BAR_TOP_PX: f64 = 24.0;
const TITLE_BAR_TOP_MAX_PX: f64 = 40.0;

/// The box's first child when it reads as a title bar: it spans the box at
/// its top, and the box is at least twice its height. Text-less layers laid
/// over the box ([`is_textless_layer`]) are passed over to find it.
fn title_bar<N: ContextNode>(c: &N) -> Option<N> {
    let all = c.children();
    let lead = all.iter().take_while(|k| is_textless_layer(*k)).count();
    let kids = &all[lead..];
    let bar = kids.first()?.clone();
    if kids.len() < 2 {
        return None;
    }
    if let (Some(b), Some(w)) = (bar.rect(), c.rect()) {
        let spans = b.2 >= w.2 * 0.6;
        let inset = px(&c.style("borderTopWidth")).unwrap_or(0.0) + px(&c.style("paddingTop")).unwrap_or(0.0);
        let reach = TITLE_BAR_TOP_PX.max(inset + 2.0).min(TITLE_BAR_TOP_MAX_PX);
        let at_top = (b.1 - w.1).abs() <= reach;
        // A bar that carries traffic lights needs only to hold them: a phone
        // layout shrinks smartbi.ca's 21px bar to 11px around 8px dots. A
        // bar read by its caption needs room for a line of text.
        let floor = if b.3 < TITLE_BAR_MIN_PX && find_dot_trio(&bar).is_some() {
            TITLE_BAR_MIN_DOTS_PX
        } else {
            TITLE_BAR_MIN_PX
        };
        let is_bar = (floor..=TITLE_BAR_MAX_PX).contains(&b.3) && w.3 >= b.3 * 2.0;
        if !(spans && at_top && is_bar && w.2 >= FRAME_MIN_WIDTH_PX) {
            return None;
        }
    }
    Some(bar)
}

/// Three dots at the title bar's leading edge: `Some(true)` when the bar
/// carries them there, `Some(false)` when its dots sit elsewhere, `None`
/// when it has no dot trio.
fn bar_leads_with_traffic_lights<N: ContextNode>(bar: &N) -> Option<bool> {
    let trio = find_dot_trio(bar)?;
    // Traffic lights sit at the bar's leading edge.
    Some(match (trio[2].rect(), bar.rect()) {
        (Some(d), Some(b)) => d.0 + d.2 <= b.0 + b.2 * 0.5,
        _ => true,
    })
}

/// A box whose first child is a title bar carrying three dots at its left,
/// or a preview caption (then the box must be drawn as a frame).
fn is_demo_window<N: ContextNode>(c: &N) -> bool {
    let Some(bar) = title_bar(c) else { return false };
    if let Some(leads) = bar_leads_with_traffic_lights(&bar) {
        if leads && !holds_code_sample(c) {
            return true;
        }
        // Dots on a code window are no cue (r14-t7); a preview caption in
        // the bar still is.
        if leads {
            return is_frame_box(c) && bar_has_preview_caption(&bar);
        }
        return false;
    }
    is_frame_box(c) && bar_has_preview_caption(&bar)
}

/// A window drawn by its traffic lights alone: a title bar with three dots
/// at its leading edge. The one demo-window test a landmark is asked
/// ([`FRAME_SKIP_TAGS`]): glowcase.app draws its product tour on an
/// `<article>` with a 44px title bar and three dots, and a page's own
/// article, section or header does not open with a row of traffic lights.
/// The preview-caption form stays off landmarks, where a section's first
/// child is often a heading band. A landmark is held to the measured test:
/// its box, its bar and the dots all have rects, so the bar's size and
/// place and the dots' leading edge are read, not assumed.
fn is_traffic_light_window<N: ContextNode>(c: &N) -> bool {
    let Some(bar) = title_bar(c) else { return false };
    let measured = c.rect().is_some()
        && bar.rect().is_some()
        && find_dot_trio(&bar).is_some_and(|trio| trio.iter().all(|d| d.rect().is_some()));
    measured
        && bar_leads_with_traffic_lights(&bar) == Some(true)
        && !landmark_holds_the_page(c)
        && !holds_code_sample(c)
}

/// Tags whose text is code.
const CODE_TAGS: &[&str] = &["pre", "code", "kbd", "samp"];

/// Whether the window's text is mostly a code sample (decision r14-t7,
/// 2026-10-26: "Bad design is bad design."): more than half its shown
/// characters sit in a `pre`, `code`, `kbd` or `samp`, or in a box whose own
/// computed face is monospace. A terminal or a config file drawn with
/// traffic lights is reading content, so its dots are no mock cue; a
/// dashboard or an app screen in the same chrome stays one.
fn holds_code_sample<N: ContextNode>(c: &N) -> bool {
    const MAX_VISITED: usize = 2000;
    let (mut code, mut all) = (0usize, 0usize);
    let mut stack = vec![(c.clone(), false)];
    let mut visited = 0usize;
    while let Some((n, in_code)) = stack.pop() {
        visited += 1;
        if visited > MAX_VISITED {
            break;
        }
        let tag = n.tag();
        // Text nobody sees takes no share: source, `display: none`, and
        // `visibility: hidden` or `collapse` (a hidden child can show again
        // under it, so only its own text is left out).
        if SOURCE_TEXT_TAGS.contains(&tag.as_str()) || n.style("display").trim() == "none" {
            continue;
        }
        let shown = !matches!(n.style("visibility").trim(), "hidden" | "collapse");
        // A code tag holds code all the way down; a face is read on each
        // box, which inherits it unless it sets its own.
        let in_code = in_code || CODE_TAGS.contains(&tag.as_str());
        let code_here = in_code || crate::checks::text_rules::is_monospace_family(&n.style("fontFamily"));
        let chars = if shown { n.direct_text().chars().filter(|ch| !ch.is_whitespace()).count() } else { 0 };
        all += chars;
        if code_here {
            code += chars;
        }
        stack.extend(n.children().into_iter().map(|k| (k, in_code)));
    }
    all > 0 && code * 2 > all
}

/// Whether a landmark is the page's own content rather than a drawing on
/// it: it holds the page's `h1`, or at least half the page's text. A blog
/// theme that draws its post as a macOS window keeps the post's findings at
/// their own severity.
fn landmark_holds_the_page<N: ContextNode>(c: &N) -> bool {
    const MAX_VISITED: usize = 2000;
    let mut stack = c.children();
    let mut visited = 0usize;
    while let Some(n) = stack.pop() {
        visited += 1;
        if visited > MAX_VISITED {
            // Too large to be a drawing.
            return true;
        }
        if n.tag() == "h1" {
            return true;
        }
        stack.extend(n.children());
    }
    let mut root = c.clone();
    while let Some(p) = root.parent() {
        root = p;
    }
    // Every label inside the window asks this again, so the page count
    // stops as soon as it settles the answer: past twice the landmark's
    // own text, the landmark cannot hold half of it.
    let own = rendered_text_chars(c, usize::MAX);
    let page = rendered_text_chars(&root, own.saturating_mul(2).saturating_add(1));
    page > 0 && own * 2 >= page
}

/// A phone frame's width range, in px, and its height over its width:
/// aproov.es draws its app on a 300 by 600px device, mypip.dev its games on
/// 150 by 329px screens.
const PHONE_MIN_WIDTH_PX: f64 = 120.0;
const PHONE_MAX_WIDTH_PX: f64 = 500.0;
const PHONE_MIN_ASPECT: f64 = 1.6;
const PHONE_MAX_ASPECT: f64 = 2.4;
/// A phone's corners are rounded at least this much, in px.
const PHONE_MIN_RADIUS_PX: f64 = 16.0;
/// How far below the frame's top edge its status-bar clock sits, at most.
const PHONE_CLOCK_TOP_PX: f64 = 50.0;
/// A frame as wide as this share of the page is the page's own column.
const PHONE_MAX_PAGE_SHARE: f64 = 0.9;

/// An `h:mm` time and nothing else: a status bar's "9:41".
static CLOCK_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^(?:[01]?\d|2[0-3]):[0-5]\d$").unwrap());

/// A drawn phone (decision r14-t1, "a phone shape with an h:mm clock in its
/// top 50px"): a measured portrait box drawn as a frame or painted as a
/// screen, its corners rounded, with a status-bar clock near its top edge. A phone-sized app
/// shell that is the page is not one: it is as wide as the page, or it
/// holds the page's `h1` or half its text ([`landmark_holds_the_page`]).
/// Every fact is measured, so an engine without layout never reads one.
fn is_phone_frame<N: ContextNode>(c: &N) -> bool {
    let Some(r) = c.rect() else { return false };
    let (w, h) = (r.2, r.3);
    if !(PHONE_MIN_WIDTH_PX..=PHONE_MAX_WIDTH_PX).contains(&w)
        || !(PHONE_MIN_ASPECT..=PHONE_MAX_ASPECT).contains(&(h / w))
        || radius_px(&c.style("borderRadius"), w) < PHONE_MIN_RADIUS_PX
        || !(has_shadow(c) || has_border(c) || paints_a_face(c))
    {
        return false;
    }
    if !holds_status_clock(c, r) {
        return false;
    }
    let mut root = c.clone();
    for _ in 0..256 {
        let Some(p) = root.parent() else { break };
        root = p;
    }
    let page_width = root.rect().map_or(0.0, |p| p.2);
    if !(page_width > 0.0 && w < page_width * PHONE_MAX_PAGE_SHARE) {
        return false;
    }
    !landmark_holds_the_page(c)
}

/// The box paints a face of its own: a fill at half opacity or more, or a
/// background image. mypip.dev's phone screen is a rounded 190 by 412px
/// fill inside a bezel drawn by sibling layers.
fn paints_a_face(c: &impl ContextNode) -> bool {
    let image = c.style("backgroundImage");
    colour_alpha(&c.style("backgroundColor")) >= 0.5 || (!image.is_empty() && image != "none")
}

/// A text box in the frame that holds an `h:mm` time and nothing else, its
/// top within [`PHONE_CLOCK_TOP_PX`] of the frame's and inside it across.
fn holds_status_clock<N: ContextNode>(c: &N, frame: (f64, f64, f64, f64)) -> bool {
    let mut level = c.children();
    let mut visited = 0usize;
    for _ in 0..6 {
        let mut next = Vec::new();
        for n in &level {
            visited += 1;
            if visited > 80 {
                return false;
            }
            let Some(b) = n.rect() else { continue };
            // A box that starts below the band holds nothing in it.
            if b.1 > frame.1 + PHONE_CLOCK_TOP_PX {
                continue;
            }
            let kids = n.children();
            if kids.is_empty() {
                let in_band = b.1 >= frame.1 - 1.0 && b.0 >= frame.0 - 1.0 && b.0 + b.2 <= frame.0 + frame.2 + 1.0;
                if in_band && CLOCK_RE.is_match(n.direct_text().trim()) && in_status_bar(n, frame) {
                    return true;
                }
            }
            next.extend(kids);
        }
        level = next;
    }
    false
}

/// The tallest row a status bar takes, in px, and the share of the frame's
/// width it spans at least.
const STATUS_BAR_MAX_PX: f64 = 36.0;
const STATUS_BAR_MIN_SHARE: f64 = 0.7;

/// The clock sits in a status bar: its parent is a short row across the
/// frame, the clock is the row's first or last child, and the row holds
/// another child with no letters (a signal glyph, a battery, a notch).
/// aproov.es pairs "9:41" with "●●● ▲", mypip.dev with a battery, and
/// iubcr.vercel.app with a notch pill and "PKT". A duration badge on a video
/// card or a start time on a schedule card is a lone box (round 14 review).
fn in_status_bar<N: ContextNode>(clock: &N, frame: (f64, f64, f64, f64)) -> bool {
    let Some(row) = clock.parent() else { return false };
    let Some(r) = row.rect() else { return false };
    if r.3 > STATUS_BAR_MAX_PX || r.2 < frame.2 * STATUS_BAR_MIN_SHARE {
        return false;
    }
    let kids = row.children();
    let edge = kids.first().is_some_and(|k| k.key() == clock.key())
        || kids.last().is_some_and(|k| k.key() == clock.key());
    edge && kids
        .iter()
        .any(|k| k.key() != clock.key() && !k.text().chars().any(char::is_alphabetic))
}

/// Elements whose text is source, not words on the page.
const SOURCE_TEXT_TAGS: &[&str] = &["script", "style", "noscript", "template"];

/// The non-whitespace characters of the text `n` and its descendants put
/// on the page. `textContent` would count a `<script>` bundle or a
/// `<style>` sheet, which can outweigh a page's whole copy. Counting stops
/// once it passes `cap`.
fn rendered_text_chars<N: ContextNode>(n: &N, cap: usize) -> usize {
    let mut count = 0usize;
    let mut stack = vec![n.clone()];
    while let Some(e) = stack.pop() {
        if count > cap {
            break;
        }
        if SOURCE_TEXT_TAGS.contains(&e.tag().as_str()) {
            continue;
        }
        count += e.direct_text().chars().filter(|ch| !ch.is_whitespace()).count();
        stack.extend(e.children());
    }
    count
}

/// A device frame that is tilted in 3D, or drawn as a frame and scaled down.
fn is_transformed_frame(c: &impl ContextNode) -> bool {
    if c.transform_running() {
        return false;
    }
    // A known size has to be frame-sized. An unknown size (the static
    // adapter's, for a box without px dimensions) is no evidence, so a tilt
    // then also needs the box drawn as a frame, and a scale, which an
    // ordinary card takes too, does not count at all.
    let size = c.size();
    if size.is_some_and(|(w, h)| w < FRAME_MIN_WIDTH_PX || h < FRAME_MIN_HEIGHT_PX) {
        return false;
    }
    let t = read_transform(&c.style("transform"));
    if t.tilt_3d {
        return size.is_some() || is_frame_box(c);
    }
    // A frame turned in the page plane counts only when it is also scaled
    // down: a card fanned at full size (a polaroid testimonial stack) is
    // content. A turn of under 3 degrees reads the scale as before.
    let turn = turn_sin(c, &t).abs();
    let turned = turn >= ROTATION_MIN_SIN;
    let tilt_free = turn < 0.01 || turned;
    size.is_some() && tilt_free && frame_scale(c, &t).is_some() && is_frame_box(c)
}

/// The box's own uniform scale, from `transform` or the `scale` property,
/// when it is in the range a shrunken device frame takes.
fn frame_scale(c: &impl ContextNode, t: &TransformRead) -> Option<f64> {
    t.uniform_scale
        .filter(|s| (*s - 1.0).abs() > 0.001)
        .or_else(|| scale_property(&c.style("scale")))
        .filter(|s| (FRAME_SCALE_MIN..=FRAME_SCALE_MAX).contains(s))
}

/// A wrapper that scales a frame drawn on a box under it: maritime.sh's
/// demo windows sit in a `scale: 0.85` wrapper with no border of its own,
/// ascenix.co's `.app` dashboard in a `pop__frame` at `matrix(0.5947, ...)`.
/// Asked only after the walk up has passed a frame-sized frame box.
fn is_scaled_wrapper(c: &impl ContextNode) -> bool {
    if c.transform_running() {
        return false;
    }
    let Some((w, h)) = c.size() else { return false };
    if w < FRAME_MIN_WIDTH_PX || h < FRAME_MIN_HEIGHT_PX {
        return false;
    }
    let t = read_transform(&c.style("transform"));
    !t.tilt_3d && turn_sin(c, &t).abs() < 0.01 && frame_scale(c, &t).is_some()
}

/// A frame-sized box drawn as a frame, its size known.
fn is_sized_frame_box(c: &impl ContextNode) -> bool {
    c.size().is_some_and(|(w, h)| w >= FRAME_MIN_WIDTH_PX && h >= FRAME_MIN_HEIGHT_PX) && is_frame_box(c)
}

/// Whether an element's text sits inside a framed HTML demo, read from
/// structure alone: an ancestor that is a window with three title-bar dots,
/// a framed box under a preview caption, or a device frame that is scaled
/// (and maybe turned 3 degrees or more in the page plane) or tilted in 3D.
/// The scale may sit on a wrapper above the frame: once the walk has passed
/// a frame-sized frame box, an ancestor scaled into the frame range counts
/// without a border of its own.
///
/// A frame-sized frame box with no title bar, scale or tilt counts when a
/// sample caption says what it is (decision r8-t1-mockups-by-caption,
/// "narrow": "A panel with a sample or illustrative caption on it or beside
/// it is mock context"): [`is_sample_caption`] on the panel's first or last
/// child, or beside the panel or a wrapper up to four levels above it.
///
/// Kept at its own severity: the preview or sample caption itself (it speaks
/// to the visitor), text in a control (a link that goes somewhere, a `button`, a
/// `label`, a control role), text under a `figcaption`, and anything in a
/// carousel slide. Sentence-length copy is left to
/// [`crate::checks::decorative_text::classify_decorative_text`].
pub fn in_framed_demo<N: ContextNode>(el: &N) -> bool {
    let text = collapse(&el.text());
    if is_preview_caption(&text) {
        return false;
    }
    match framed_walk(el, false) {
        Some(Frame::Chrome) => true,
        // The caption that names the panel speaks to the visitor.
        Some(Frame::Captioned) => !is_sample_caption(&text),
        None => false,
    }
}

/// What the walk up recognised a framed demo by.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Frame {
    /// Window chrome or a device frame: title-bar dots, a preview caption
    /// in a title bar, a scale or a tilt.
    Chrome,
    /// A frame box a sample caption sits on or beside (r8-t1).
    Captioned,
}

/// The walk up behind [`in_framed_demo`]. `passed_frame` says a frame-sized
/// frame box already sits below the start, which [`is_demo_frame`] passes
/// for a frame box asking about its own wrapper.
fn framed_walk<N: ContextNode>(el: &N, mut passed_frame: bool) -> Option<Frame> {
    let mut cur = Some(el.clone());
    let mut depth = 0usize;
    // Levels climbed since the last frame-sized frame box.
    let mut above_frame = 0usize;
    while let Some(c) = cur {
        let tag = c.tag();
        if FRAME_STOP_TAGS.contains(&tag.as_str()) || tag == "figcaption" {
            return None;
        }
        // A control inside the frame is still a control: adant.ai's tab
        // buttons in its terminal card are clicked.
        if (tag == "a" && c.attr("href").is_some())
            || DEMO_CONTROL_TAGS.contains(&tag.as_str())
            || c.attr("role").is_some_and(|r| DEMO_CONTROL_ROLES.contains(&r.trim().to_lowercase().as_str()))
        {
            return None;
        }
        if has_part(&c.class_list(), SLIDE_PARTS) {
            return None;
        }
        if depth > 0
            && !FRAME_SKIP_TAGS.contains(&tag.as_str())
            && (is_transformed_frame(&c)
                || is_demo_window(&c)
                || (passed_frame && is_scaled_wrapper(&c))
                || is_phone_frame(&c))
        {
            return Some(Frame::Chrome);
        }
        // A landmark is never a frame by its scale, tilt or size, but a
        // window drawn on one still has its traffic lights.
        if depth > 0 && FRAME_SKIP_TAGS.contains(&tag.as_str()) && is_traffic_light_window(&c) {
            return Some(Frame::Chrome);
        }
        if depth > 0 && !FRAME_SKIP_TAGS.contains(&tag.as_str()) && is_sized_frame_box(&c) {
            // r8-t1: the panel carries a sample caption.
            if has_sample_caption_on(&c) {
                return Some(Frame::Captioned);
            }
            passed_frame = true;
            above_frame = 0;
        }
        // r8-t1: a sample caption beside the panel, or beside a wrapper a
        // few levels above it.
        if passed_frame {
            if above_frame <= SAMPLE_CAPTION_BESIDE_LEVELS && has_sample_caption_beside(&c) {
                return Some(Frame::Captioned);
            }
            above_frame += 1;
        }
        depth += 1;
        if depth > 24 {
            return None;
        }
        cur = c.parent();
    }
    None
}

/// Whether the box itself is a framed HTML demo by the structure
/// [`in_framed_demo`] reads off an ancestor: a window with three title-bar
/// dots, a framed box under a preview caption, or a device frame scaled or
/// tilted in 3D, or a frame box under a wrapper scaled into the frame
/// range, or a frame box with a sample caption on it or beside it. `nested-cards` asks it of an inner card, which can be the
/// window itself (stroq.dev's editor window inside a card), as well as
/// asking [`in_framed_demo`] (decision r6-t3-nested-cards-mockups). A
/// landmark counts only as a window with traffic lights.
pub fn is_demo_frame<N: ContextNode>(el: &N) -> bool {
    if FRAME_SKIP_TAGS.contains(&el.tag().as_str()) {
        return !has_part(&el.class_list(), SLIDE_PARTS) && is_traffic_light_window(el);
    }
    !has_part(&el.class_list(), SLIDE_PARTS)
        && (is_transformed_frame(el)
            || is_demo_window(el)
            || is_phone_frame(el)
            // maritime.sh's window is the frame box; the scale sits on a
            // wrapper above it.
            || (is_sized_frame_box(el) && (has_sample_caption_on(el) || framed_walk(el, true).is_some())))
}

// ─── r5-p27: legal fine print ───────────────────────────────────────────────

/// Substrings of a class or id that mark fine print. The first nine are the
/// class markers `undersized-ui-text` already reads for its smallprint floor
/// (its `SMALLPRINT` selector, without the bare `footer`: a footer holds
/// navigation and addresses too); `terms` is the decision's own.
pub const FINE_PRINT_MARKERS: &[&str] = &[
    "legal",
    "copyright",
    "fineprint",
    "fine-print",
    "smallprint",
    "small-print",
    "disclaimer",
    "disclosure",
    "footnote",
    "terms",
];
/// Fine print is set under this size, in px.
pub const FINE_PRINT_MAX_PX: f64 = 15.0;
/// How far up a fine-print marker is read. A paragraph in a marked list
/// item sits two levels under the marker; a `legal-page` wrapper around a
/// whole document sits further, and its prose is read.
pub const FINE_PRINT_MARKER_DEPTH: usize = 3;
/// Tags whose class says nothing about one paragraph being fine print.
const FINE_PRINT_SKIP_TAGS: &[&str] = &["html", "body", "main", "article", "form"];
/// A mark a footnote opens with.
const FOOTNOTE_MARKS: &[char] = &['*', '†', '‡', '§', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];

/// The markers that name a legal or footnote block outright (decision 3,
/// round 13): text under one of them is exempt from `line-length` and
/// `tiny-text`. `copyright` and `terms` stay advisory: they also mark a
/// photo credit, a timing note or a row of links. `disclosure` is strict
/// only in the plural ([`LEGAL_PLURAL_ONLY`]).
pub const LEGAL_BLOCK_MARKERS: &[&str] = &[
    "legal",
    "fineprint",
    "fine-print",
    "smallprint",
    "small-print",
    "disclaimer",
    "footnote",
];
/// Markers that name a legal block only in the plural. A `disclosure`, in
/// the singular, is also the WAI-ARIA name of an expand/collapse widget
/// (target.com's `menuDisclosure`, Osano's `osano-cm-disclosure__toggle`),
/// so it stays advisory; `disclosures` is a list of them.
pub const LEGAL_PLURAL_ONLY: &[&str] = &["disclosure"];
/// Words that turn a following `footnote` into the name of a type size
/// (Apple's "Footnote" text style: `text-footnote`, `upl-type-footnote`).
const TYPE_SCALE_WORDS: &[&str] = &["type", "text", "typography", "font", "fs"];

/// Which markers a class or id carries: `None`, any of
/// [`FINE_PRINT_MARKERS`] (`Advisory`), or one of [`LEGAL_BLOCK_MARKERS`]
/// or the plural of [`LEGAL_PLURAL_ONLY`] (`Exempt`). A marker counts as a
/// whole token (`legal`, `copyright-notice`, `fine-print`, `footnote_2`,
/// plural `disclaimers`, camelCase `legalNotice`), never as a part of a
/// longer word (`illegal`, `testimonials`). A `footnote` after a type-scale
/// word in the same token (`text-footnote`) is a size name and only
/// advisory.
fn fine_print_marker(class_or_id: &str) -> FinePrint {
    let mut found = FinePrint::No;
    for token in class_or_id.split_whitespace() {
        // Words split at `-`, `_` and a lowercase-to-uppercase step.
        let mut spaced = String::with_capacity(token.len() + 4);
        let mut prev_lower = false;
        for ch in token.chars() {
            if ch == '-' || ch == '_' {
                spaced.push(' ');
                prev_lower = false;
                continue;
            }
            if ch.is_uppercase() && prev_lower {
                spaced.push(' ');
            }
            prev_lower = ch.is_lowercase() || ch.is_ascii_digit();
            spaced.extend(ch.to_lowercase());
        }
        let words: Vec<&str> = spaced.split_whitespace().collect();
        // Where a marker of one or more words (`fine-print` is two in a
        // row) starts, with its last word as typed or plural.
        let starts = |m: &str, plural_only: bool| -> Vec<usize> {
            let parts: Vec<&str> = m.split('-').collect();
            let last = parts.len() - 1;
            words
                .windows(parts.len())
                .enumerate()
                .filter(|(_, w)| {
                    w[..last] == parts[..last]
                        && ((!plural_only && w[last] == parts[last])
                            || w[last].strip_suffix('s') == Some(parts[last]))
                })
                .map(|(i, _)| i)
                .collect()
        };
        let strict = LEGAL_BLOCK_MARKERS.iter().any(|m| {
            starts(m, false).into_iter().any(|i| {
                !(*m == "footnote" && i > 0 && TYPE_SCALE_WORDS.contains(&words[i - 1]))
            })
        }) || LEGAL_PLURAL_ONLY.iter().any(|m| !starts(m, true).is_empty());
        if strict {
            return FinePrint::Exempt;
        }
        if FINE_PRINT_MARKERS.iter().any(|m| !starts(m, false).is_empty()) {
            found = FinePrint::Advisory;
        }
    }
    found
}

/// Whether a box marked as a legal block is, or directly holds, an
/// expand/collapse widget: a `details`, a `summary` or a control with
/// `aria-expanded`. Its text is an accordion panel a visitor opened, so the
/// marker stays advisory (freenet.de's `footer-footnote-accordion` keeps
/// its advisory, not silence).
fn is_disclosure_widget<N: ContextNode>(c: &N) -> bool {
    let widget = |k: &N| matches!(k.tag().as_str(), "details" | "summary") || k.attr("aria-expanded").is_some();
    widget(c) || c.children().iter().any(widget)
}

/// The fewest characters a legal block holds to read as a policy page's
/// body (about a screen of 14px text).
pub const LEGAL_PAGE_MIN_CHARS: usize = 2000;

/// [`rendered_text_chars`] without hidden subtrees (a `hidden` attribute
/// no author `display` undoes, `aria-hidden="true"` or `display: none`): a hidden mobile copy of a
/// policy is not text a visitor reads, on either side of the comparison.
fn visible_text_chars<N: ContextNode>(n: &N, cap: usize) -> usize {
    let mut count = 0usize;
    let mut stack = vec![n.clone()];
    while let Some(e) = stack.pop() {
        if count > cap {
            break;
        }
        // A `hidden` element that author CSS sets to a display renders
        // (`[hidden].reveal { display: block }`), except `until-found`.
        let display = e.style("display");
        let display = display.trim();
        let hidden_attr = e.attr("hidden").is_some_and(|v| {
            v.trim().eq_ignore_ascii_case("until-found") || display.is_empty() || display == "none"
        });
        if SOURCE_TEXT_TAGS.contains(&e.tag().as_str())
            || hidden_attr
            || e.attr("aria-hidden").is_some_and(|v| v.trim().eq_ignore_ascii_case("true"))
            || display == "none"
        {
            continue;
        }
        count += e.direct_text().chars().filter(|ch| !ch.is_whitespace()).count();
        stack.extend(e.children());
    }
    count
}

/// Whether a box marked as a legal block is a policy page's own body text
/// rather than a block on the page: it sits under no `footer` or
/// `role="contentinfo"`, holds at least [`LEGAL_PAGE_MIN_CHARS`]
/// characters, and holds at least half the page's text. A privacy policy
/// under `div.legal-content` at 14px is a document a visitor reads, so it
/// stays advisory.
fn is_legal_page_body<N: ContextNode>(el: &N, marked: &N) -> bool {
    let mut cur = Some(el.clone());
    let mut root = el.clone();
    while let Some(c) = cur {
        if c.tag() == "footer" || c.attr("role").is_some_and(|r| r.trim().eq_ignore_ascii_case("contentinfo")) {
            return false;
        }
        root = c.clone();
        cur = c.parent();
    }
    let own = visible_text_chars(marked, usize::MAX);
    if own < LEGAL_PAGE_MIN_CHARS {
        return false;
    }
    let page = visible_text_chars(&root, own.saturating_mul(2).saturating_add(1));
    page > 0 && own * 2 >= page
}

/// Whether a class or id names fine print by any of [`FINE_PRINT_MARKERS`].
#[cfg(test)]
fn has_fine_print_marker(class_or_id: &str) -> bool {
    fine_print_marker(class_or_id) != FinePrint::No
}

/// The shortest block, in characters, that reads as a footnote when it
/// opens with a mark. "* Indicates a required field" is form help.
pub const FOOTNOTE_MIN_CHARS: usize = 60;

/// The block opens with an asterisk or a footnote mark, typed or set in a
/// leading `sup`, and runs on for at least [`FOOTNOTE_MIN_CHARS`].
fn opens_with_footnote_mark(el: &impl ContextNode) -> bool {
    let text = collapse(&el.text());
    if text.chars().count() < FOOTNOTE_MIN_CHARS {
        return false;
    }
    if text.starts_with(FOOTNOTE_MARKS) {
        return true;
    }
    // A leading `<sup>1</sup>`: the block's text starts with the mark, and
    // the block's own words follow it.
    let kids = el.children();
    let Some(sup) = kids.first().filter(|k| k.tag() == "sup") else { return false };
    let mark = collapse(&sup.text());
    !mark.is_empty()
        && mark.chars().count() <= 3
        && text.starts_with(&mark)
        && collapse(&el.direct_text()).chars().count() >= FOOTNOTE_MIN_CHARS / 2
}

/// How an element's text reads as fine print. Both tiers are set under
/// [`FINE_PRINT_MAX_PX`] and are never a heading, a label or a control's
/// text.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum FinePrint {
    /// Not fine print.
    No,
    /// Fine print by weaker evidence: a `small` tag, a `copyright` or
    /// `terms` marker, or a block that opens with a footnote mark. It reports
    /// as advisory under `line-length`, `tiny-text` and `tight-leading`
    /// (taste call r5-p27).
    Advisory,
    /// A legal or footnote block: one of [`LEGAL_BLOCK_MARKERS`] on the
    /// element or up to [`FINE_PRINT_MARKER_DEPTH`] levels up. Exempt from
    /// `line-length` and `tiny-text`, advisory under `tight-leading`
    /// (decision 3, round 13). Links inside it keep `undersized-ui-text`,
    /// which does not read this.
    Exempt,
}

/// Whether an element's text is legal fine print, in either tier of
/// [`fine_print`].
pub fn is_fine_print<N: ContextNode>(el: &N) -> bool {
    fine_print(el) != FinePrint::No
}

/// Whether an element's text is legal fine print: set under
/// [`FINE_PRINT_MAX_PX`], and marked by a `small` tag, or by a class or id
/// (on it or up to [`FINE_PRINT_MARKER_DEPTH`] levels up), or opening with
/// an asterisk or a footnote mark. A legal or footnote marker
/// ([`LEGAL_BLOCK_MARKERS`]) in that reach makes it [`FinePrint::Exempt`];
/// the rest is [`FinePrint::Advisory`]. A leading mark alone stays
/// advisory: it counts as a footnote only inside such a block, which the
/// marker already settles.
///
/// Not fine print: text in a `label` (a consent line a visitor has to read
/// to tick the box), a block holding a form control, and a heading.
pub fn fine_print<N: ContextNode>(el: &N) -> FinePrint {
    if is_heading(el) {
        return FinePrint::No;
    }
    // Fine print is set small. A rules page under a `legal` wrapper at body
    // size (agenticworldcup.ai/rules, 17px) is a document a visitor reads.
    let size = el.font_size();
    if !(size > 0.0 && size < FINE_PRINT_MAX_PX) {
        return FinePrint::No;
    }
    let mut cur = Some(el.clone());
    while let Some(c) = cur {
        let tag = c.tag();
        if tag == "label" || is_heading(&c) {
            return FinePrint::No;
        }
        if FRAME_STOP_TAGS.contains(&tag.as_str()) {
            break;
        }
        cur = c.parent();
    }
    // A form control beside the text, or inside it, makes it the control's
    // label: a custom checkbox row keeps the input next to a span.
    let control = |k: &N| matches!(k.tag().as_str(), "input" | "select" | "textarea" | "button");
    // A checkbox or radio right beside the text labels it (a custom checkbox
    // row); a control elsewhere in the container is unrelated.
    let check = |k: &N| {
        k.tag() == "input"
            && k.attr("type").is_some_and(|t| matches!(t.trim().to_ascii_lowercase().as_str(), "checkbox" | "radio"))
    };
    // A sibling with no text of its own that holds a checkbox (a styled
    // wrapper around the input) labels it the same way.
    fn wraps_check<N: ContextNode>(k: &N, check: &impl Fn(&N) -> bool, depth: usize) -> bool {
        check(k) || (depth > 0 && k.children().iter().any(|c| wraps_check(c, check, depth - 1)))
    }
    let check_beside = |k: &N| check(k) || (collapse(&k.text()).is_empty() && wraps_check(k, &check, 3));
    let beside = el.parent().is_some_and(|p| {
        let kids = p.children();
        kids.iter().position(|k| k.key() == el.key()).is_some_and(|i| {
            (i > 0 && check_beside(&kids[i - 1])) || kids.get(i + 1).is_some_and(|k| check_beside(k))
        })
    });
    if el.children().iter().any(control) || beside {
        return FinePrint::No;
    }
    // The walk climbs past a `small` or a weaker marker: mercury.com sets
    // its banner disclaimer in a `small` inside `#disclaimer-banner`.
    let mut found = FinePrint::No;
    // Every legal-marked box in reach, inner first: an inner `p.footnote`
    // inside a marked accordion or policy body is demoted with it.
    let mut legal: Vec<N> = Vec::new();
    let mut cur = Some(el.clone());
    for _ in 0..=FINE_PRINT_MARKER_DEPTH {
        let Some(c) = cur else { break };
        let tag = c.tag();
        if FINE_PRINT_SKIP_TAGS.contains(&tag.as_str()) {
            break;
        }
        let marker = fine_print_marker(&c.class_list()).max(fine_print_marker(&c.id_attr()));
        if marker == FinePrint::Exempt {
            legal.push(c.clone());
        } else if tag == "small" || marker == FinePrint::Advisory {
            found = FinePrint::Advisory;
        }
        cur = c.parent();
    }
    if let Some(outer) = legal.last() {
        // An accordion panel and a policy page's body are demoted, not
        // dropped (decision 3 review, round 13). The outermost marked box
        // holds the most text, so it alone settles the policy-page test.
        if legal.iter().any(is_disclosure_widget) || is_legal_page_body(el, outer) {
            return FinePrint::Advisory;
        }
        return FinePrint::Exempt;
    }
    if found == FinePrint::No && opens_with_footnote_mark(el) {
        found = FinePrint::Advisory;
    }
    found
}

// ─── r5-p3: micro-labels ────────────────────────────────────────────────────

/// The longest label that is still "a few words".
pub const MICRO_LABEL_MAX_WORDS: usize = 4;
pub const MICRO_LABEL_MAX_CHARS: usize = 32;
/// A tick or an axis label is shorter still.
pub const CHART_LABEL_MAX_WORDS: usize = 3;
pub const CHART_LABEL_MAX_CHARS: usize = 16;
/// How much larger than the label a number beside a unit is set.
pub const UNIT_NUMBER_SCALE: f64 = 1.3;
/// How much larger than the label an untagged title beside a pill is set,
/// and its smallest size in px.
pub const DISPLAY_TITLE_SCALE: f64 = 1.5;
pub const DISPLAY_TITLE_MIN_PX: f64 = 18.0;
/// The smallest plot (a `canvas` or an `svg`) a label can caption, in px.
pub const PLOT_MIN_WIDTH_PX: f64 = 100.0;
pub const PLOT_MIN_HEIGHT_PX: f64 = 40.0;

/// Tags a micro-label never sits in: a control, navigation, a form, a table
/// cell (data a visitor reads), a definition.
const MICRO_LABEL_STOP_TAGS: &[&str] = &[
    "a", "button", "label", "summary", "select", "option", "textarea", "nav", "form", "td", "th",
    "dt", "dd", "legend", "figcaption", "caption", "time",
];
const MICRO_LABEL_STOP_ROLES: &[&str] = &[
    "button", "link", "tab", "menuitem", "option", "checkbox", "radio", "switch", "navigation",
    "cell", "gridcell", "tooltip", "alert", "status",
];
/// Class or id parts that name a chart's own furniture.
const CHART_PARTS: &[&str] = &[
    "axis", "chart", "charts", "gauge", "graph", "histogram", "plot", "sparkline", "tick",
    "ticks", "xaxis", "yaxis",
];
/// How far up a chart marker is read.
const CHART_MARKER_DEPTH: usize = 4;
/// Units a number is counted in.
const UNITS: &[&str] = &[
    "%", "d", "day", "days", "h", "hr", "hrs", "hour", "hours", "m", "min", "mins", "minute",
    "minutes", "s", "sec", "secs", "second", "seconds", "ms", "wk", "wks", "week", "weeks", "mo",
    "mos", "month", "months", "yr", "yrs", "year", "years", "kb", "mb", "gb", "tb", "px", "pt",
    "hz", "khz", "mhz", "ghz", "fps", "bpm", "rpm", "km", "cm", "mm", "mi", "ft", "kg", "g",
    "mg", "lb", "lbs", "oz", "ml", "l", "kwh", "kw", "w", "v", "mph", "kph", "°c", "°f", "°",
    "x", "pts", "일", "시간", "분", "초", "日", "時間", "分", "秒", "天", "小时", "分钟",
];

static NUMBER_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[+\-−~≈<>]?\d[\d.,:]*[kKmMbB+]?$").expect("NUMBER_RE"));
static STEP_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:0\d|\d{1,2}[.)]|(?:step|no\.?|#)\s?\d{1,2})$").expect("STEP_RE")
});

fn has_money(text: &str) -> bool {
    text.chars().any(|c| matches!(c, '$' | '€' | '£' | '¥' | '₩' | '₹' | '₽' | '₺' | '₫' | '฿'))
}

/// Text small enough to be a label: a few words, no sentence end, no price.
fn is_few_words(text: &str, max_words: usize, max_chars: usize) -> bool {
    !text.is_empty()
        && word_count(text) <= max_words
        && text.chars().count() <= max_chars
        && !has_money(text)
        && !text.ends_with(['.', '!', '?', '。', '！', '？'])
}

/// A heading, or a block that starts (`leading`) or ends with one, two
/// levels deep at most.
fn holds_heading<N: ContextNode>(n: &N, leading: bool, depth: usize) -> bool {
    if is_heading(n) {
        return true;
    }
    if depth == 0 {
        return false;
    }
    let kids = n.children();
    let pick = if leading { kids.first() } else { kids.last() };
    pick.is_some_and(|k| holds_heading(k, leading, depth - 1))
}

/// An untagged title: a short run of text and nothing else, set at display
/// size and well above the label's.
fn is_display_title(n: &impl ContextNode, label_px: f64) -> bool {
    let text = collapse(&n.text());
    let size = n.font_size();
    !text.is_empty()
        && collapse(&n.direct_text()) == text
        && word_count(&text) <= 8
        && !is_sentence_copy(&text)
        && !has_money(&text)
        // A title is words. A figure set large (`1-3`, `8+`, `10,000`) is a
        // stat, and the small text beside it is what the stat means.
        && !text.chars().any(|c| c.is_numeric())
        && text.chars().filter(|c| c.is_alphabetic()).count() >= 2
        && size >= DISPLAY_TITLE_MIN_PX
        && size >= label_px * DISPLAY_TITLE_SCALE
}

/// A box drawn as a pill: rounded, with a fill or a border of its own.
fn is_pill(n: &impl ContextNode) -> bool {
    let image = n.style("backgroundImage");
    is_rounded(n)
        && (colour_alpha(&n.style("backgroundColor")) > 0.1
            || (!image.is_empty() && image != "none")
            || has_border(n))
}

/// A pill or an eyebrow beside a heading: the element, or the wrapper it is
/// the only child of, sits next to a heading (or a block that opens or
/// closes with one), or next to an untagged title. An eyebrow comes before
/// its heading and opens its group. A label after a heading is a subtitle,
/// which is read, unless it is drawn as a pill.
fn beside_heading<N: ContextNode>(el: &N) -> bool {
    let label_px = el.font_size();
    let pill = is_pill(el);
    let beside = |n: &N| {
        let (prev, next, all) = siblings(n);
        // An eyebrow opens its group: nothing with text comes before it. A
        // note that closes one block is not the eyebrow of the next block's
        // heading.
        let opens = all
            .iter()
            .take_while(|s| s.key() != n.key())
            .all(|s| collapse(&s.text()).is_empty());
        (opens
            && next.as_ref().is_some_and(|n| holds_heading(n, true, 2) || is_display_title(n, label_px)))
            || ((pill || is_pill(n))
                && prev.as_ref().is_some_and(|p| holds_heading(p, false, 2) || is_display_title(p, label_px)))
    };
    if beside(el) {
        return true;
    }
    // One wrapper, and only one that holds the label and nothing else: a
    // card whose only text is this label is not a pill.
    el.parent().is_some_and(|p| {
        p.children().len() == 1 && collapse(&p.direct_text()).is_empty() && beside(&p)
    })
}

/// A unit beside the number it counts (`05` over `Days`).
fn is_unit_marker<N: ContextNode>(el: &N, text: &str) -> bool {
    let unit = text.trim_end_matches('.').to_lowercase();
    if !UNITS.contains(&unit.as_str()) {
        return false;
    }
    let label_px = el.font_size();
    let (prev, next, _) = siblings(el);
    [prev, next].into_iter().flatten().any(|s| {
        NUMBER_RE.is_match(&collapse(&s.text())) && s.font_size() >= label_px * UNIT_NUMBER_SCALE
    })
}

/// A step marker beside the step it numbers (`01` before a title).
fn is_step_marker<N: ContextNode>(el: &N, text: &str) -> bool {
    if !STEP_RE.is_match(text) {
        return false;
    }
    let label_px = el.font_size();
    let (_, _, all) = siblings(el);
    all.iter().filter(|s| s.key() != el.key()).any(|s| {
        s.font_size() > label_px
            && collapse(&s.text()).chars().filter(|c| c.is_alphabetic()).count() >= 2
    })
}

fn centre_in(inner: (f64, f64, f64, f64), outer: (f64, f64, f64, f64)) -> bool {
    let (cx, cy) = (inner.0 + inner.2 / 2.0, inner.1 + inner.3 / 2.0);
    cx >= outer.0 && cx <= outer.0 + outer.2 && cy >= outer.1 && cy <= outer.1 + outer.3
}

/// A tick or an axis label inside a chart: a chart marker on the way up, a
/// label drawn over a sibling plot, or one of a run of absolutely placed
/// labels lined up along an axis.
fn is_chart_label<N: ContextNode>(el: &N, text: &str) -> bool {
    if !is_few_words(text, CHART_LABEL_MAX_WORDS, CHART_LABEL_MAX_CHARS) {
        return false;
    }
    let mut cur = Some(el.clone());
    for _ in 0..=CHART_MARKER_DEPTH {
        let Some(c) = cur else { break };
        if FRAME_STOP_TAGS.contains(&c.tag().as_str()) || FRAME_SKIP_TAGS.contains(&c.tag().as_str()) {
            break;
        }
        if has_part(&c.class_list(), CHART_PARTS) || has_part(&c.id_attr(), CHART_PARTS) {
            return true;
        }
        cur = c.parent();
    }
    let (_, _, all) = siblings(el);
    let Some(own) = el.rect() else { return false };
    let over_plot = all.iter().any(|s| {
        matches!(s.tag().as_str(), "canvas" | "svg")
            && s.rect().is_some_and(|r| {
                r.2 >= PLOT_MIN_WIDTH_PX && r.3 >= PLOT_MIN_HEIGHT_PX && centre_in(own, r)
            })
    });
    if over_plot {
        return true;
    }
    if el.style("position") != "absolute" {
        return false;
    }
    let (tag, class) = (el.tag(), el.class_list());
    let run: Vec<(f64, f64, f64, f64)> = all
        .iter()
        .filter(|s| {
            s.tag() == tag
                && s.class_list() == class
                && s.children().is_empty()
                && s.style("position") == "absolute"
                && is_few_words(&collapse(&s.text()), CHART_LABEL_MAX_WORDS, CHART_LABEL_MAX_CHARS)
        })
        .filter_map(|s| s.rect())
        .collect();
    if run.len() < 3 {
        return false;
    }
    let column = run.iter().all(|r| (r.0 - run[0].0).abs() <= 1.5);
    let row = run.iter().all(|r| (r.1 - run[0].1).abs() <= 1.5);
    column != row
}

/// Whether text under the UI text floor is a label with no reading job: a
/// pill or eyebrow of a few words beside a heading, a unit or step marker
/// beside a number, a tick or axis label inside a chart.
///
/// Kept at its own severity: text in or under a control, navigation, a
/// form, a table cell, a definition or a `time`; a price or anything with a
/// currency sign; a pill or eyebrow with a figure in it (a date, a count, a
/// discount); text that ends a sentence; and an element whose text is not
/// all its own (a label with children is measured child by child).
pub fn is_micro_label<N: ContextNode>(el: &N) -> bool {
    let text = collapse(&el.text());
    if text.is_empty() || collapse(&el.direct_text()) != text || is_heading(el) {
        return false;
    }
    let mut cur = Some(el.clone());
    while let Some(c) = cur {
        let tag = c.tag();
        if MICRO_LABEL_STOP_TAGS.contains(&tag.as_str())
            || c.attr("role").is_some_and(|r| MICRO_LABEL_STOP_ROLES.contains(&r.trim().to_lowercase().as_str()))
            || is_heading(&c)
        {
            return false;
        }
        if FRAME_STOP_TAGS.contains(&tag.as_str()) {
            break;
        }
        cur = c.parent();
    }
    if has_money(&text) {
        return false;
    }
    if is_unit_marker(el, &text) || is_step_marker(el, &text) || is_chart_label(el, &text) {
        return true;
    }
    // A pill or an eyebrow is words. A date, a count, a version or a
    // discount carries a figure a visitor reads.
    is_few_words(&text, MICRO_LABEL_MAX_WORDS, MICRO_LABEL_MAX_CHARS)
        && !text.contains('%')
        && !text.chars().any(|c| c.is_numeric())
        && beside_heading(el)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::rc::Rc;

    #[derive(Default)]
    struct Raw {
        tag: String,
        class: String,
        id: String,
        attrs: HashMap<String, String>,
        parent: Option<usize>,
        children: Vec<usize>,
        text: String,
        styles: HashMap<String, String>,
        font: f64,
        rect: Option<(f64, f64, f64, f64)>,
        running: bool,
        /// Own text comes after the children's.
        tail: bool,
    }

    #[derive(Clone)]
    struct Tree(Rc<RefCell<Vec<Raw>>>);

    #[derive(Clone)]
    struct N(Tree, usize);

    impl Tree {
        fn new() -> (Tree, N) {
            let t = Tree(Rc::new(RefCell::new(vec![Raw { tag: "body".into(), font: 16.0, ..Default::default() }])));
            (t.clone(), N(t, 0))
        }
    }

    impl N {
        fn add(&self, tag: &str) -> N {
            let mut v = (self.0).0.borrow_mut();
            let font = v[self.1].font;
            let i = v.len();
            v.push(Raw { tag: tag.into(), parent: Some(self.1), font, ..Default::default() });
            v[self.1].children.push(i);
            N(self.0.clone(), i)
        }
        fn with(self, f: impl FnOnce(&mut Raw)) -> N {
            f(&mut (self.0).0.borrow_mut()[self.1]);
            self
        }
        fn text(self, t: &str) -> N {
            self.with(|r| r.text = t.into())
        }
        fn class(self, c: &str) -> N {
            self.with(|r| r.class = c.into())
        }
        fn font(self, px: f64) -> N {
            self.with(|r| r.font = px)
        }
        fn rect(self, x: f64, y: f64, w: f64, h: f64) -> N {
            self.with(|r| r.rect = Some((x, y, w, h)))
        }
        fn style(self, k: &str, v: &str) -> N {
            self.with(|r| {
                r.styles.insert(k.into(), v.into());
            })
        }
        fn attr(self, k: &str, v: &str) -> N {
            self.with(|r| {
                r.attrs.insert(k.into(), v.into());
            })
        }
    }

    impl ContextNode for N {
        fn key(&self) -> u64 {
            self.1 as u64
        }
        fn tag(&self) -> String {
            (self.0).0.borrow()[self.1].tag.clone()
        }
        fn class_list(&self) -> String {
            (self.0).0.borrow()[self.1].class.clone()
        }
        fn id_attr(&self) -> String {
            (self.0).0.borrow()[self.1].id.clone()
        }
        fn attr(&self, name: &str) -> Option<String> {
            (self.0).0.borrow()[self.1].attrs.get(name).cloned()
        }
        fn parent(&self) -> Option<Self> {
            (self.0).0.borrow()[self.1].parent.map(|p| N(self.0.clone(), p))
        }
        fn children(&self) -> Vec<Self> {
            (self.0).0.borrow()[self.1].children.iter().map(|c| N(self.0.clone(), *c)).collect()
        }
        fn text(&self) -> String {
            let (own, tail) = {
                let v = (self.0).0.borrow();
                (v[self.1].text.clone(), v[self.1].tail)
            };
            let kids: Vec<String> = self.children().iter().map(ContextNode::text).collect();
            if tail {
                format!("{} {own}", kids.join(" "))
            } else {
                format!("{own} {}", kids.join(" "))
            }
        }
        fn direct_text(&self) -> String {
            (self.0).0.borrow()[self.1].text.clone()
        }
        fn style(&self, prop: &str) -> String {
            (self.0).0.borrow()[self.1].styles.get(prop).cloned().unwrap_or_default()
        }
        fn font_size(&self) -> f64 {
            (self.0).0.borrow()[self.1].font
        }
        fn rect(&self) -> Option<(f64, f64, f64, f64)> {
            (self.0).0.borrow()[self.1].rect
        }
        fn transform_running(&self) -> bool {
            (self.0).0.borrow()[self.1].running
        }
    }

    fn dot(bar: &N, x: f64) -> N {
        bar.add("span")
            .rect(x, 12.0, 10.0, 10.0)
            .style("borderRadius", "9999px")
            .style("backgroundColor", "rgb(238, 58, 58)")
    }

    /// A window: a title bar with three dots, and a body holding one label.
    fn window(body: &N) -> (N, N, N) {
        let win = body.add("div").rect(0.0, 0.0, 600.0, 400.0);
        let bar = win.add("div").rect(0.0, 0.0, 600.0, 36.0);
        let lights = bar.add("div").rect(12.0, 12.0, 42.0, 10.0);
        for i in 0..3 {
            dot(&lights, 12.0 + 16.0 * i as f64);
        }
        let pane = win.add("div").rect(0.0, 36.0, 600.0, 364.0);
        let label = pane.add("span").text("847 results").font(9.0);
        (win, bar, label)
    }

    #[test]
    fn transforms_read_from_matrices_and_functions() {
        let tilt = read_transform(
            "matrix3d(1, 0, 0, 0, 0, 0.999391, 0.0348995, -2.90829e-05, 0, -0.0348995, 0.999391, -0.000832826, 0, 0, 0, 1)",
        );
        assert!(tilt.tilt_3d);
        assert!(read_transform("perspective(900px) rotateX(8deg)").tilt_3d);
        assert!(read_transform("rotateY(-0.2rad)").tilt_3d);
        assert!(read_transform("rotate3d(1, 0, 0, 12deg)").tilt_3d);
        // A promoted layer, a card flipped on its back and a flat spin are
        // not tilted frames.
        assert!(!read_transform("matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,1,1)").tilt_3d);
        assert!(!read_transform("rotateY(180deg)").tilt_3d);
        assert!(!read_transform("rotate3d(0, 0, 1, 30deg)").tilt_3d);
        assert!(!read_transform("rotateX(0deg) rotateY(0deg)").tilt_3d);
        assert_eq!(read_transform("matrix(0.7, 0, 0, 0.7, 0, 0)").uniform_scale, Some(0.7));
        // A 2D scale the browser folded into matrix3d (translate3d + scale).
        assert_eq!(read_transform("matrix3d(0.7, 0, 0, 0, 0, 0.7, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)").uniform_scale, Some(0.7));
        assert_eq!(read_transform("matrix3d(0.7, 0, 0.3, 0, 0, 0.7, 0, 0, -0.3, 0, 1, 0, 0, 0, 0, 1)").uniform_scale, None);
        assert!(has_fine_print_marker("site-legal"));
        assert!(has_fine_print_marker("fine-print note"));
        assert!(has_fine_print_marker("copyright_notice"));
        assert!(!has_fine_print_marker("illegal-moves"));
        assert!(!has_fine_print_marker("testimonials"));
        assert!(has_fine_print_marker("legalNotice"));
        assert!(has_fine_print_marker("smallPrint"));
        assert!(has_fine_print_marker("FinePrint"));
        assert!(!has_fine_print_marker("illegalMoves"));
        assert_eq!(read_transform("scale(0.75)").uniform_scale, Some(0.75));
        assert_eq!(read_transform("matrix(1, 0, 0, 1, -5.4, 0)").uniform_scale, Some(1.0));
        assert_eq!(read_transform("scale(0.7, 1)").uniform_scale, None);
        // A turn in the page plane keeps the scale; a skew does not.
        let turned = read_transform("rotate(-4deg) scale(0.7)");
        assert_eq!(turned.uniform_scale, Some(0.7));
        assert!((turned.turn_rad - (-4f64).to_radians()).abs() < 1e-9);
        // Composed turns add as angles, not as sines.
        let composed = read_transform("rotate(100deg) rotate(78deg) scale(0.78)");
        assert!((composed.turn_rad.sin() - 178f64.to_radians().sin()).abs() < 1e-9);
        let deck = read_transform("matrix(0.762955, -0.162171, 0.162171, 0.762955, -466.4, 106)");
        assert!((deck.uniform_scale.unwrap() - 0.78).abs() < 0.01);
        assert!((deck.turn_rad - (-12f64).to_radians()).abs() < 0.01);
        let flat = read_transform("matrix3d(0.762955, -0.162171, 0, 0, 0.162171, 0.762955, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)");
        assert!((flat.uniform_scale.unwrap() - 0.78).abs() < 0.01);
        assert_eq!(read_transform("matrix(0.7, 0, 0.3, 0.7, 0, 0)").uniform_scale, None);
        assert_eq!(read_transform("rotate(10deg) skewX(10deg) scale(0.7)").uniform_scale, None);
        assert_eq!(read_transform("perspective(900px) rotateX(8deg) rotate(10deg) scale(0.7)").uniform_scale, None);
        assert_eq!(read_transform("scale(0.7)").turn_rad, 0.0);
        // The turn is read without a scale in the same value.
        assert!((read_transform("rotate(2deg)").turn_rad - 2f64.to_radians()).abs() < 1e-9);
        assert_eq!(rotate_property("10deg"), Some(10f64.to_radians()));
        assert_eq!(rotate_property("z 10deg"), Some(10f64.to_radians()));
        assert_eq!(rotate_property("0 0 1 10deg"), Some(10f64.to_radians()));
        assert_eq!(rotate_property("x 10deg"), None);
        assert_eq!(rotate_property("none"), None);
        assert_eq!(read_transform("none"), TransformRead::default());
    }

    #[test]
    fn a_window_drawn_on_a_landmark_is_read_by_its_traffic_lights() {
        // glowcase.app 321817: the product tour is an `<article>` with a
        // 44px title bar and three dots.
        let (_t, body) = Tree::new();
        body.add("p").text("Glowcase turns your product into an interactive demo that buyers explore on their own.");
        let (win, _bar, label) = window(&body);
        (win.0).0.borrow_mut()[win.1].tag = "article".into();
        assert!(in_framed_demo(&label));
        assert!(is_demo_frame(&win));
        // The same window holding the page's h1 is the page's own post.
        let h1 = win.add("h1").text("Notes");
        assert!(!in_framed_demo(&label));
        (h1.0).0.borrow_mut()[h1.1].tag = "h2".into();
        assert!(in_framed_demo(&label));
        // Holding most of the page's text, it is the page too.
        let (_t, body) = Tree::new();
        let (win, _bar, label) = window(&body);
        (win.0).0.borrow_mut()[win.1].tag = "article".into();
        assert!(!in_framed_demo(&label), "the only text on the page");
        // A script bundle or a style sheet is not text on the page.
        body.add("script").text(&"window.__APP_STATE__ = {};".repeat(200));
        body.add("style").text(&".a { color: red; }".repeat(200));
        assert!(!in_framed_demo(&label), "the only words on the page, beside a bundle");
        // A section whose title bar carries a preview caption but no dots
        // stays a landmark the walk passes through.
        let (_t, body) = Tree::new();
        let sec = body.add("section").rect(0.0, 0.0, 600.0, 400.0).style("borderTopWidth", "1px");
        let head = sec.add("div").rect(0.0, 0.0, 600.0, 36.0);
        head.add("span").text("Live preview").font(10.0);
        let pane = sec.add("div").rect(0.0, 36.0, 600.0, 364.0);
        let plain = pane.add("span").text("847 results").font(9.0);
        assert!(!in_framed_demo(&plain));
        assert!(!is_demo_frame(&sec));
        // Dots at the trailing edge of a landmark's bar are not traffic lights.
        let (_t, body) = Tree::new();
        let art = body.add("article").rect(0.0, 0.0, 600.0, 400.0);
        let bar = art.add("div").rect(0.0, 0.0, 600.0, 36.0);
        let lights = bar.add("div").rect(500.0, 12.0, 42.0, 10.0);
        for i in 0..3 {
            dot(&lights, 500.0 + 16.0 * i as f64);
        }
        let pane = art.add("div").rect(0.0, 36.0, 600.0, 364.0);
        let text = pane.add("span").text("847 results").font(9.0);
        assert!(!in_framed_demo(&text));
        // An unsized landmark whose unsized first child holds three dots
        // (review): with no rects for the box and the bar, their size and
        // place and the dots' leading edge are not known, and the landmark
        // stays one the walk passes through.
        let (_t, body) = Tree::new();
        body.add("p").text("Glowcase turns your product into an interactive demo that buyers explore on their own.");
        let art = body.add("article");
        let bar = art.add("div");
        let lights = bar.add("div");
        for i in 0..3 {
            dot(&lights, 12.0 + 16.0 * i as f64);
        }
        let text = art.add("div").add("span").text("847 results").font(9.0);
        assert!(!in_framed_demo(&text));
    }

    /// Decision r14-t7: a dotted window that holds a code sample is reading
    /// content; a dashboard in the same chrome stays a mock.
    #[test]
    fn a_dotted_window_holding_code_is_no_mock() {
        // A docs config window: the text is in a `pre`.
        let (_t, body) = Tree::new();
        let (win, bar, label) = window(&body);
        bar.add("span").text("config.toml");
        let pre = win.children()[1].add("pre");
        let line = pre.add("span").text("timeout_ms = 3000  # default, raise for slow networks");
        pre.add("span").text("retries = 2  # attempts after the first");
        assert!(!in_framed_demo(&line));
        assert!(!in_framed_demo(&label));
        assert!(!is_demo_frame(&win));
        // The same text set in a monospace face, no `pre`.
        let (_t, body) = Tree::new();
        let (win, _bar, _label) = window(&body);
        let mono = win.children()[1]
            .add("div")
            .style("fontFamily", "\"JetBrains Mono\", ui-monospace, monospace")
            .text("const client = createClient({ retries: 2, timeoutMs: 3000 })");
        assert!(!in_framed_demo(&mono));
        // A dashboard in the same chrome, with one short code chip, stays a
        // mock.
        let (_t, body) = Tree::new();
        let (win, _bar, label) = window(&body);
        let pane = win.children()[1].clone();
        pane.add("span").text("Revenue this quarter");
        pane.add("span").text("Active subscriptions by plan");
        pane.add("code").text("v2");
        assert!(in_framed_demo(&label));
        assert!(is_demo_frame(&win));
        // Review on #1197: monospace chrome over a sans pane is a dashboard,
        // hidden code takes no share, and a preview caption still counts.
        let (_t, body) = Tree::new();
        let (win, _bar, label) = window(&body);
        let win = win.style("fontFamily", "ui-monospace, monospace");
        let pane = win.children()[1].clone().style("fontFamily", "Inter, sans-serif");
        pane.add("span").text("Revenue this quarter by plan and region").style("fontFamily", "Inter, sans-serif");
        let _ = label.clone().style("fontFamily", "Inter, sans-serif");
        assert!(in_framed_demo(&label), "sans pane in mono chrome");
        let (_t, body) = Tree::new();
        let (win, _bar, label) = window(&body);
        let hidden = win.children()[1].add("pre").style("display", "none");
        hidden.add("span").text("const client = createClient({ retries: 2, timeoutMs: 3000 })");
        assert!(in_framed_demo(&label), "hidden code");
        let (_t, body) = Tree::new();
        let (win, bar, _label) = window(&body);
        let win = framed(win);
        bar.add("span").text("Live preview");
        let line = win.children()[1].add("pre").add("span").text("retries = 2  # attempts after the first");
        assert!(in_framed_demo(&line), "a preview caption on a code window");
    }

    #[test]
    fn a_window_with_three_title_bar_dots_is_a_demo() {
        let (_t, body) = Tree::new();
        let (_win, bar, label) = window(&body);
        assert!(in_framed_demo(&label));
        // Text in the title bar is in the window too.
        let url = bar.add("span").text("Dashboard").font(10.0);
        assert!(in_framed_demo(&url));
        // The caption that calls it a preview speaks to the visitor.
        let caption = bar.add("span").text("Simulated preview").font(9.0);
        assert!(!in_framed_demo(&caption));
        // A link that goes somewhere and a button are controls, mock or not.
        let pane = label.parent().unwrap();
        let link = pane.add("a").attr("href", "/pricing");
        let linked = link.add("span").text("See plans").font(10.0);
        assert!(!in_framed_demo(&linked));
        let tab = pane.add("button").text("Any agent").font(10.5);
        assert!(!in_framed_demo(&tab));
        let role = pane.add("div").attr("role", "tab").add("span").text("Codex").font(10.5);
        assert!(!in_framed_demo(&role));
    }

    /// observations-1004 row 15 (smartbi.ca 10047914): the phone layout
    /// shrinks the title bar to 11px around 8px dots. A bar that short is a
    /// title bar only by its dots; a caption needs the old 12px.
    #[test]
    fn a_short_title_bar_is_read_by_its_dots() {
        let short_window = |bar_h: f64, dot_side: f64| {
            let (_t, body) = Tree::new();
            let win = body.add("div").rect(0.0, 0.0, 330.0, 239.0);
            let bar = win.add("div").rect(0.0, 0.0, 310.0, bar_h);
            let lights = bar.add("div").rect(0.0, 0.0, 34.0, bar_h);
            for i in 0..3 {
                lights
                    .add("span")
                    .rect(13.0 * i as f64, 1.5, dot_side, dot_side)
                    .style("borderRadius", "9999px")
                    .style("backgroundColor", "rgb(238, 58, 58)");
            }
            let label = win.add("div").rect(0.0, 20.0, 330.0, 219.0).add("span").text("-4.2%").font(10.0);
            in_framed_demo(&label)
        };
        assert!(short_window(11.0, 8.0), "an 11px bar holding 8px dots");
        assert!(short_window(8.0, 6.0), "the floor");
        assert!(!short_window(7.0, 6.0), "under the floor");
        // A caption in a bar that short is not read as a title bar.
        let (_t, body) = Tree::new();
        let frame = body
            .add("div")
            .rect(0.0, 0.0, 600.0, 400.0)
            .style("borderRadius", "12px")
            .style("boxShadow", "rgba(0, 0, 0, 0.2) 0px 8px 24px");
        frame.add("div").rect(0.0, 0.0, 600.0, 11.0).add("span").text("Live preview");
        let label = frame.add("div").rect(0.0, 11.0, 600.0, 389.0).add("span").text("Draft saved");
        assert!(!in_framed_demo(&label), "an 11px caption bar");
    }

    #[test]
    fn dots_that_are_not_window_chrome() {
        // Two dots, four dots, pagination bullets, buttons, dots at the
        // bottom and dots at the right are not a title bar.
        for n in [2usize, 4] {
            let (_t, body) = Tree::new();
            let win = body.add("div").rect(0.0, 0.0, 600.0, 400.0);
            let bar = win.add("div").rect(0.0, 0.0, 600.0, 36.0);
            for i in 0..n {
                dot(&bar, 12.0 + 16.0 * i as f64);
            }
            let label = win.add("div").rect(0.0, 36.0, 600.0, 364.0).add("span").text("Ready");
            assert!(!in_framed_demo(&label), "{n} dots");
        }
        let (_t, body) = Tree::new();
        let win = body.add("div").rect(0.0, 0.0, 600.0, 400.0);
        let pager = win.add("div").class("swiper-pagination").rect(0.0, 0.0, 600.0, 36.0);
        for i in 0..3 {
            dot(&pager, 12.0 + 16.0 * i as f64);
        }
        let label = win.add("div").add("span").text("Ready");
        assert!(!in_framed_demo(&label), "pagination");

        let (_t, body) = Tree::new();
        let win = body.add("div").rect(0.0, 0.0, 600.0, 400.0);
        let bar = win.add("div").rect(0.0, 0.0, 600.0, 36.0);
        for i in 0..3 {
            dot(&bar, 12.0 + 16.0 * i as f64).with(|r| r.tag = "button".into());
        }
        let label = win.add("div").add("span").text("Ready");
        assert!(!in_framed_demo(&label), "buttons");

        let (_t, body) = Tree::new();
        let win = body.add("div").rect(0.0, 0.0, 600.0, 400.0);
        let bar = win.add("div").rect(0.0, 364.0, 600.0, 36.0);
        for i in 0..3 {
            dot(&bar, 12.0 + 16.0 * i as f64);
        }
        let label = win.add("div").add("span").text("Ready");
        assert!(!in_framed_demo(&label), "a bar at the bottom");

        let (_t, body) = Tree::new();
        let win = body.add("div").rect(0.0, 0.0, 600.0, 400.0);
        let bar = win.add("div").rect(0.0, 0.0, 600.0, 36.0);
        let group = bar.add("div").rect(540.0, 12.0, 42.0, 10.0);
        for i in 0..3 {
            dot(&group, 540.0 + 16.0 * i as f64);
        }
        let label = win.add("div").add("span").text("Ready");
        assert!(!in_framed_demo(&label), "dots at the trailing edge");
    }

    #[test]
    fn a_preview_caption_needs_a_frame() {
        let (_t, body) = Tree::new();
        let frame = body
            .add("div")
            .rect(0.0, 0.0, 600.0, 400.0)
            .style("borderRadius", "12px")
            .style("boxShadow", "rgba(0, 0, 0, 0.2) 0px 8px 24px");
        let bar = frame.add("div").rect(0.0, 0.0, 600.0, 36.0);
        bar.add("span").text("Live preview");
        let label = frame.add("div").rect(0.0, 36.0, 600.0, 364.0).add("span").text("Draft saved");
        assert!(in_framed_demo(&label));
        // The same caption over an unframed block says nothing.
        let (_t, body) = Tree::new();
        let plain = body.add("div").rect(0.0, 0.0, 600.0, 400.0);
        plain.add("div").rect(0.0, 0.0, 600.0, 36.0).add("span").text("Live preview");
        let label = plain.add("div").add("span").text("Draft saved");
        assert!(!in_framed_demo(&label));
        // A Preview tab is a control, and a sentence is not a caption.
        let (_t, body) = Tree::new();
        let frame = body
            .add("div")
            .rect(0.0, 0.0, 600.0, 400.0)
            .style("borderRadius", "12px")
            .style("boxShadow", "rgba(0, 0, 0, 0.2) 0px 8px 24px");
        let bar = frame.add("div").rect(0.0, 0.0, 600.0, 36.0);
        bar.add("button").text("Preview");
        bar.add("span").text("Preview the next release early");
        let label = frame.add("div").add("span").text("Draft saved");
        assert!(!in_framed_demo(&label));
        assert!(is_preview_caption("Simulated preview"));
        assert!(is_preview_caption("PREVIEW"));
        assert!(!is_preview_caption("Previews"));
        assert!(!is_preview_caption("Preview the next release"));
    }

    #[test]
    fn sample_captions_are_a_closed_set_of_labels() {
        for yes in [
            "Sample data. No real resident information appears on this site.",
            "Illustrative example. Figures shown are not customer data.",
            "Illustrative",
            "ILLUSTRATIVE REPORT ONLY",
            "Illustrative markdown",
            "Sample data",
            "Example figures only",
            "Placeholder values",
            "Demo data",
            "Sample data: updated hourly",
            "Sample data · 3 homes",
            "Illustrative values, shown only to explain each workflow.",
            "Fictional",
            "Fictional company data",
        ] {
            assert!(is_sample_caption(yes), "{yes}");
        }
        for no in [
            // suitemigration.com: a sentence that works the word in.
            "An example project mid-migration. Each stage shows how far one customer's data has travelled, not which features SuiteMigration has shipped.",
            "An example project mid-migration.",
            "Sample",
            "Example",
            "Mockup",
            "Sample data sheet",
            "Sample rate",
            "Sample output",
            "Example response",
            "Samples",
            "Examples",
            "Demo",
            "Book a demo",
            "Mock test",
            "Preview",
            // context.dev: a mark inside a word closes no label.
            "example.com/pricing",
            "Sample-rate converter",
            "Exemple",
            "Beispiel",
            "サンプル",
            "",
            "Sample data. This note runs on past the single line of small print a caption carries, into a paragraph of ordinary copy.",
        ] {
            assert!(!is_sample_caption(no), "{no}");
        }
    }

    /// A panel drawn as a frame, 600 by 400, with a header and a body; the
    /// label in the body is what the rules ask about.
    fn panel(parent: &N) -> (N, N, N) {
        let frame = framed(parent.add("div").rect(0.0, 0.0, 600.0, 400.0));
        let head = frame.add("div").rect(0.0, 0.0, 600.0, 120.0);
        head.add("span").text("Decision Center");
        let body = frame.add("div").rect(0.0, 120.0, 600.0, 240.0);
        let label = body.add("span").text("Confidence");
        (frame, head, label)
    }

    #[test]
    fn a_sample_caption_on_the_panel() {
        // getpaidlens.com: an "Illustrative" pill in a 129px header, and a
        // footer note as the last child.
        let (_t, body) = Tree::new();
        let (frame, head, label) = panel(&body);
        assert!(!in_framed_demo(&label), "no caption, no mockup");
        assert!(!is_demo_frame(&frame));
        let pill = head.add("span").text("Illustrative");
        assert!(in_framed_demo(&label));
        assert!(is_demo_frame(&frame));
        assert!(!in_framed_demo(&pill), "the caption speaks to the visitor");

        let (_t, body) = Tree::new();
        let (frame, _head, label) = panel(&body);
        let note = frame.add("div").text("Illustrative example. Figures shown are not customer data.");
        assert!(in_framed_demo(&label));
        assert!(!in_framed_demo(&note));

        // A panel whose header and footer sit in its one wrapper.
        let (_t2, body2) = Tree::new();
        let inner = framed(body2.add("div").rect(0.0, 0.0, 600.0, 400.0)).add("div").add("div");
        inner.add("div").add("span").text("Decision Center");
        let wrapped = inner.add("div").add("span").text("Confidence");
        assert!(!in_framed_demo(&wrapped));
        inner.add("p").text("Illustrative example. Figures shown are not customer data.");
        assert!(in_framed_demo(&wrapped));

        // A control in the panel keeps its severity.
        let button = frame.children()[1].add("button").text("Approve");
        assert!(!in_framed_demo(&button));

        // The word in a heading, a link, a sentence or a paragraph's bold
        // lead-in is not a caption.
        for build in [
            (|head: &N| { head.add("h3").text("Sample data"); }) as fn(&N),
            |head| { head.add("a").attr("href", "/demo").text("Sample data"); },
            |head| { head.add("p").text("An example project mid-migration."); },
            |head| { head.add("p").text("shows what a report holds.").add("b").text("Sample data"); },
            |head| { head.add("pre").add("span").text("Sample data"); },
            |head| { head.add("div").attr("role", "button").add("span").text("Sample data"); },
        ] {
            let (_t, body) = Tree::new();
            let (frame, head, label) = panel(&body);
            build(&head);
            assert!(!in_framed_demo(&label));
            assert!(!is_demo_frame(&frame));
        }

        // A caption on a box that is not drawn as a frame says nothing.
        let (_t, body) = Tree::new();
        let plain = body.add("div").rect(0.0, 0.0, 600.0, 400.0);
        plain.add("div").add("span").text("Illustrative");
        let label = plain.add("div").add("span").text("Confidence");
        assert!(!in_framed_demo(&label));
    }

    #[test]
    fn a_sample_label_in_a_window_is_part_of_the_picture() {
        // A frame recognised by its chrome needs no caption, so a label in
        // it that happens to read as one is mock context like the rest.
        let (_t, body) = Tree::new();
        let (_win, _bar, results) = window(&body);
        let label = results.parent().unwrap().add("span").text("Sample data");
        assert!(in_framed_demo(&label));
    }

    #[test]
    fn a_sample_caption_beside_the_panel() {
        // ascenix.co: the note closes the tab set, three wrappers above
        // each panel.
        let (_t, body) = Tree::new();
        let wrap = body.add("div");
        let heading = wrap.add("h2").text("One layer over your records");
        let pane = wrap.add("div");
        let (frame, _head, label) = panel(&pane.add("article").add("div"));
        let outside = wrap.add("div").add("span").text("Ask us the rest");
        assert!(!in_framed_demo(&label));
        let note = wrap.add("p").text("Sample data. No real resident information appears on this site.");
        assert!(in_framed_demo(&label));
        assert!(is_demo_frame(&frame));
        assert!(!in_framed_demo(&note));
        assert!(!in_framed_demo(&heading), "text outside every frame is the page's own");
        assert!(!in_framed_demo(&outside));

        // Directly after the panel.
        let (_t, body) = Tree::new();
        let pair = body.add("div");
        let (_frame, _head, label) = panel(&pair);
        pair.add("p").text("Sample data");
        assert!(in_framed_demo(&label));

        // Too far above the panel, or a child of the page shell.
        let (_t, body) = Tree::new();
        let wrap = body.add("div");
        let deep = wrap.add("div").add("div").add("div").add("div").add("div").add("div");
        let (_frame, _head, label) = panel(&deep);
        wrap.add("p").text("Sample data");
        assert!(!in_framed_demo(&label));
        let (_t, body) = Tree::new();
        let (_frame, _head, label) = panel(&body);
        body.add("p").text("Sample data");
        assert!(!in_framed_demo(&label));
    }

    /// observations-1010 row 1, gap 1: cursorhelper.vercel.app's window
    /// opens with an `aria-hidden` absolute glow, and mymanagment.net's bar
    /// sits under 24px of padding and a 1px border.
    #[test]
    fn a_title_bar_behind_a_glow_or_padding() {
        let build = |glow: Option<(&str, &str)>, pad: f64| {
            let (_t, body) = Tree::new();
            let win = body.add("div").rect(0.0, 0.0, 520.0, 370.0).style("paddingTop", &format!("{pad}px")).style("borderTopWidth", "1px");
            if let Some((k, v)) = glow {
                let layer = win.add("div").rect(0.0, 0.0, 520.0, 370.0);
                if k == "aria-hidden" {
                    layer.attr(k, v);
                } else {
                    layer.style(k, v);
                }
            }
            let top = 1.0 + pad;
            let bar = win.add("div").rect(0.0, top, 520.0, 45.0);
            let lights = bar.add("div").rect(14.0, top + 17.0, 42.0, 10.0);
            for i in 0..3 {
                lights.add("span").rect(14.0 + 16.0 * i as f64, top + 17.0, 10.0, 10.0).style("borderRadius", "50%").style("backgroundColor", "rgba(248, 113, 113, 0.5)");
            }
            let pane = win.add("div").rect(0.0, top + 45.0, 520.0, 300.0);
            pane.add("span").text("Context Router").font(10.0)
        };
        assert!(in_framed_demo(&build(None, 0.0)));
        assert!(in_framed_demo(&build(Some(("aria-hidden", "true")), 0.0)), "an aria-hidden glow first");
        assert!(in_framed_demo(&build(Some(("position", "absolute")), 0.0)), "an absolute layer first");
        assert!(!in_framed_demo(&build(Some(("position", "relative")), 0.0)), "a box in flow first is the first child");
        assert!(in_framed_demo(&build(None, 24.0)), "a bar at the padding edge");
        assert!(!in_framed_demo(&build(None, 60.0)), "a bar part way down the box");

        // An aria-hidden bar that carries the dots is the bar, not a glow
        // (review on #1197).
        let (_t, body) = Tree::new();
        let (win, bar, label) = window(&body);
        let _ = bar.attr("aria-hidden", "true");
        assert!(in_framed_demo(&label), "an aria-hidden dotted bar");
        let _ = win;

        // A layer that holds text is content, not a glow.
        let (_t, body) = Tree::new();
        let (win, _bar, label) = window(&body);
        let first = win.add("div").attr("aria-hidden", "true").text("Beta");
        let kids = win.children();
        (win.0).0.borrow_mut()[win.1].children = std::iter::once(first.1).chain(kids.iter().map(|k| k.1).filter(|k| *k != first.1)).collect();
        assert!(!in_framed_demo(&label));
    }

    /// observations-1010 row 1, gap 3: usedefinite.com's caption is labelled
    /// by its first words up to a comma.
    #[test]
    fn a_caption_label_ends_at_a_comma() {
        assert!(is_sample_caption("Illustrative values, shown only to explain each workflow."));
        assert!(is_sample_caption("Fictional company, invented figures."));
        // A comma closes only a label with an illustrative word in it, and
        // `fictional` is said of data or a company (the review's probes).
        assert!(!is_sample_caption("Sample data, exports and reports are kept for 30 days on every plan."));
        assert!(!is_sample_caption("Sample data, refreshed nightly"));
        assert!(!is_sample_caption("Fictional worlds, real heartbreak."));
        assert!(!is_sample_caption("Fictional heroes"));
        assert!(!is_sample_caption("Illustrations, photos and video by our studio team in Berlin."));
        assert!(!is_sample_caption("Our sample, data and reports in one place"));
        // usedefinite.com 10136830: the caption itself keeps reporting.
        let (_t, body) = Tree::new();
        let wrap = body.add("div");
        let grid = wrap.add("div");
        let (_frame, _head, label) = panel(&grid.add("div"));
        let note = wrap.add("p").text("Illustrative values, shown only to explain each workflow.");
        assert!(in_framed_demo(&label));
        assert!(!in_framed_demo(&note));
    }

    /// A phone: 300 by 600, rounded and shadowed, a status bar with a 9:41
    /// clock at its top, on a 1280px page (aproov.es).
    fn phone(page: &N, w: f64, h: f64, clock: &str, clock_y: f64) -> (N, N) {
        let device = page
            .add("div")
            .rect(490.0, 1346.0, w, h)
            .style("borderRadius", "40px")
            .style("boxShadow", "rgba(42, 30, 16, 0.25) 0px 30px 60px 0px");
        let screen = device.add("div").rect(500.0, 1356.0, w - 20.0, h - 20.0).style("borderRadius", "30px");
        let status = screen.add("div").rect(500.0, 1356.0, w - 20.0, 26.0);
        status.add("span").rect(518.0, 1346.0 + clock_y, 18.0, 15.0).text(clock).font(10.0);
        status.add("span").rect(700.0, 1362.0, 40.0, 15.0).text("●●● ▲").font(10.0);
        let label = screen.add("div").rect(510.0, 1500.0, 200.0, 14.0).text("distribution network").font(10.0);
        (device, label)
    }

    #[test]
    fn a_phone_with_a_status_clock() {
        let page = |w: f64| {
            let (t, body) = Tree::new();
            let body = body.rect(0.0, 0.0, w, 3000.0);
            body.add("main").add("h1").text("Run every channel from one inbox");
            body.add("p").text(&"Copy that belongs to the page itself. ".repeat(20));
            (t, body)
        };
        let (_t, body) = page(1280.0);
        let (device, label) = phone(&body.add("section").add("div"), 300.0, 600.0, "9:41", 16.0);
        assert!(is_phone_frame(&device));
        assert!(in_framed_demo(&label));
        assert!(is_demo_frame(&device));

        // The clock has to be a time near the top of the frame.
        for (clock, y) in [("9:41", 70.0), ("9:41 AM ready", 16.0), ("25:10", 16.0), ("Inbox", 16.0)] {
            let (_t, body) = page(1280.0);
            let (device, label) = phone(&body.add("div"), 300.0, 600.0, clock, y);
            assert!(!is_phone_frame(&device), "{clock} at {y}");
            assert!(!in_framed_demo(&label));
        }
        // Not phone-shaped: a landscape card, a tall narrow strip.
        for (w, h) in [(600.0, 400.0), (120.0, 600.0), (300.0, 300.0)] {
            let (_t, body) = page(1280.0);
            let (device, _label) = phone(&body.add("div"), w, h, "9:41", 16.0);
            assert!(!is_phone_frame(&device), "{w}x{h}");
        }
        // The should-flag twin: a phone-shaped app shell that is the page.
        // It holds the page's h1, or it spans a phone-width page.
        let (_t, body) = Tree::new();
        let body = body.rect(0.0, 0.0, 1280.0, 900.0);
        let (shell, label) = phone(&body.add("div"), 420.0, 860.0, "9:41", 16.0);
        shell.add("h1").text("Departures");
        assert!(!is_phone_frame(&shell));
        assert!(!in_framed_demo(&label));
        let (_t, body) = Tree::new();
        let body = body.rect(0.0, 0.0, 390.0, 844.0);
        body.add("p").text("x");
        let (shell, _label) = phone(&body.add("div"), 390.0, 844.0, "9:41", 16.0);
        assert!(!is_phone_frame(&shell));
        // An unmeasured page (the static engine) reads no phone.
        let (_t, body) = Tree::new();
        let (device, _label) = phone(&body.add("div"), 300.0, 600.0, "9:41", 16.0);
        assert!(!is_phone_frame(&device));
        // The clock has to sit in a status bar (round 14 review): a duration
        // badge on a portrait video card, a start time on a talk card, and
        // an app header with a title beside a time are not one.
        let card = |build: &dyn Fn(&N)| {
            let (_t, body) = page(1280.0);
            let card = body
                .add("div")
                .rect(100.0, 400.0, 240.0, 427.0)
                .style("borderRadius", "16px")
                .style("backgroundColor", "rgb(17, 17, 17)");
            build(&card);
            card
        };
        let badge = card(&|c: &N| {
            c.add("span").rect(112.0, 412.0, 30.0, 16.0).text("0:45");
        });
        assert!(!is_phone_frame(&badge), "a duration badge");
        let talk = card(&|c: &N| {
            let head = c.add("div").rect(100.0, 410.0, 240.0, 20.0);
            head.add("span").rect(112.0, 412.0, 40.0, 16.0).text("09:30");
        });
        assert!(!is_phone_frame(&talk), "a start time alone in its row");
        let header = card(&|c: &N| {
            let head = c.add("div").rect(100.0, 400.0, 240.0, 32.0);
            head.add("span").rect(112.0, 408.0, 120.0, 16.0).text("Central Station");
            head.add("span").rect(290.0, 408.0, 40.0, 16.0).text("14:05");
        });
        assert!(!is_phone_frame(&header), "a title beside a time");
        let tall = card(&|c: &N| {
            let head = c.add("div").rect(100.0, 400.0, 240.0, 48.0);
            head.add("span").rect(112.0, 410.0, 30.0, 16.0).text("9:41");
            head.add("span").rect(300.0, 410.0, 30.0, 16.0).text("▲");
        });
        assert!(!is_phone_frame(&tall), "a row too tall for a status bar");
        let narrow = card(&|c: &N| {
            let head = c.add("div").rect(100.0, 400.0, 100.0, 24.0);
            head.add("span").rect(112.0, 404.0, 30.0, 16.0).text("9:41");
            head.add("i").rect(160.0, 404.0, 20.0, 10.0);
        });
        assert!(!is_phone_frame(&narrow), "a row that does not span the screen");
        let bar = card(&|c: &N| {
            let head = c.add("div").rect(100.0, 400.0, 240.0, 24.0);
            head.add("span").rect(112.0, 404.0, 30.0, 16.0).text("9:41");
            head.add("i").rect(290.0, 404.0, 20.0, 10.0);
        });
        assert!(is_phone_frame(&bar), "a clock and a battery");
        // Only a frame drawn as a device counts.
        let (_t, body) = page(1280.0);
        let (device, _label) = phone(&body.add("div"), 300.0, 600.0, "9:41", 16.0);
        let bare = device.style("boxShadow", "none");
        assert!(!is_phone_frame(&bare));
        // A screen painted with a fill counts (mypip.dev), a faint one not.
        let screen = bare.clone().style("backgroundColor", "rgb(9, 9, 11)");
        assert!(is_phone_frame(&screen));
        let faint = screen.style("backgroundColor", "rgba(9, 9, 11, 0.2)");
        assert!(!is_phone_frame(&faint));
    }

    #[test]
    fn device_frames_scaled_or_tilted() {
        let (_t, body) = Tree::new();
        let tilted = body
            .add("div")
            .rect(0.0, 0.0, 400.0, 300.0)
            .style("transform", "matrix3d(1, 0, 0, 0, 0, 0.99, 0.15, 0, 0, -0.15, 0.99, 0, 0, 0, 0, 1)");
        let label = tilted.add("div").add("span").text("coldtea.ai");
        assert!(in_framed_demo(&label));
        // The same tilt on a box of unknown size (the static engine without px
        // dimensions) is no evidence of a frame, unless the box is drawn as one.
        let (_t, body) = Tree::new();
        let unknown = body
            .add("div")
            .style("transform", "matrix3d(1, 0, 0, 0, 0, 0.99, 0.15, 0, 0, -0.15, 0.99, 0, 0, 0, 0, 1)");
        assert!(!in_framed_demo(&unknown.add("div").add("span").text("coldtea.ai")));
        let (_t, body) = Tree::new();
        let drawn = body
            .add("div")
            .style("transform", "matrix3d(1, 0, 0, 0, 0, 0.99, 0.15, 0, 0, -0.15, 0.99, 0, 0, 0, 0, 1)")
            .style("borderRadius", "12px")
            .style("boxShadow", "rgba(0, 0, 0, 0.12) 0px 8px 24px");
        assert!(in_framed_demo(&drawn.add("div").add("span").text("coldtea.ai")));
        // A scaled card drawn as a frame needs a known size.
        let (_t, body) = Tree::new();
        let scaled_card = body
            .add("div")
            .style("transform", "matrix(0.7, 0, 0, 0.7, 0, 0)")
            .style("borderRadius", "16px")
            .style("boxShadow", "rgba(0, 0, 0, 0.1) 0px 20px 25px");
        assert!(!in_framed_demo(&scaled_card.add("div").add("span").text("8:24 AM")));

        let (_t, body) = Tree::new();
        let scaled = body
            .add("div")
            .rect(0.0, 0.0, 224.0, 196.0)
            .style("transform", "matrix(0.7, 0, 0, 0.7, 0, 0)")
            .style("borderRadius", "16px")
            .style("boxShadow", "rgba(0, 0, 0, 0.1) 0px 20px 25px");
        let label = scaled.add("div").add("span").text("8:24 AM");
        assert!(in_framed_demo(&label));
        // Scaled but not drawn as a frame, a resting scale-90 card, a
        // transform caught mid-animation, a small tilted badge and a slide
        // in a coverflow keep their severity.
        let (_t, body) = Tree::new();
        let bare = body.add("div").rect(0.0, 0.0, 224.0, 196.0).style("transform", "matrix(0.7, 0, 0, 0.7, 0, 0)");
        assert!(!in_framed_demo(&bare.add("span").text("8:24 AM")));
        let card = body
            .add("div")
            .rect(0.0, 0.0, 224.0, 196.0)
            .style("transform", "matrix(0.9, 0, 0, 0.9, 0, 0)")
            .style("borderRadius", "16px")
            .style("boxShadow", "rgba(0, 0, 0, 0.1) 0px 20px 25px");
        assert!(!in_framed_demo(&card.add("span").text("Starter")));
        let moving = body
            .add("div")
            .rect(0.0, 0.0, 400.0, 300.0)
            .style("transform", "perspective(900px) rotateX(8deg)")
            .with(|r| r.running = true);
        assert!(!in_framed_demo(&moving.add("span").text("Ready")));
        let badge = body.add("div").rect(0.0, 0.0, 60.0, 24.0).style("transform", "rotateY(12deg)");
        assert!(!in_framed_demo(&badge.add("span").text("New")));
        let slide = body
            .add("div")
            .class("swiper-slide")
            .rect(0.0, 0.0, 400.0, 300.0)
            .style("transform", "rotateY(40deg)");
        assert!(!in_framed_demo(&slide.add("span").text("Jane Doe")));
        // The frame's own text is not inside a frame.
        let own = body.add("div").rect(0.0, 0.0, 400.0, 300.0).style("transform", "rotateY(12deg)").text("Tilted");
        assert!(!in_framed_demo(&own));
    }

    fn framed(n: N) -> N {
        n.style("borderRadius", "14px")
            .style("borderTopWidth", "1px")
            .style("borderRightWidth", "1px")
            .style("borderBottomWidth", "1px")
            .style("borderLeftWidth", "1px")
            .style("borderTopColor", "rgba(255, 255, 255, 0.25)")
            .style("borderRightColor", "rgba(255, 255, 255, 0.25)")
            .style("borderBottomColor", "rgba(255, 255, 255, 0.25)")
            .style("borderLeftColor", "rgba(255, 255, 255, 0.25)")
    }

    #[test]
    fn a_scale_on_a_wrapper_above_the_frame() {
        // maritime.sh: a `scale: 0.85` wrapper with no border, two plain
        // boxes down a bordered, rounded window with no transform.
        let (_t, body) = Tree::new();
        let wrapper = body.add("div").rect(77.0, 1176.0, 507.0, 323.0).style("scale", "0.85");
        let stage = wrapper.add("div").rect(130.0, 1210.0, 400.0, 255.0);
        let win = framed(stage.add("div").rect(322.0, 1366.0, 201.0, 99.0));
        let bar = win.add("div").rect(323.0, 1367.0, 199.0, 31.0);
        let url = bar.add("span").add("span").text("mail.google.com").font(10.5);
        assert!(in_framed_demo(&url));
        // nested-cards asks it of the window itself.
        assert!(is_demo_frame(&win));
        assert!(!is_demo_frame(&framed(body.add("div").rect(0.0, 0.0, 400.0, 300.0))));
        // ascenix.co: the frame box sits right under the scaled wrapper.
        let (_t, body) = Tree::new();
        let pop = body.add("div").rect(349.0, 843.0, 583.0, 333.0).style("transform", "matrix(0.594738, 0, 0, 0.594738, 0, 0)");
        let app = pop
            .add("div")
            .rect(349.0, 843.0, 583.0, 333.0)
            .style("borderRadius", "20px")
            .style("boxShadow", "rgba(11, 18, 32, 0.1) 0px 24px 60px 0px");
        let foot = app.add("div").add("div").add("div").text("Previous period incidents: 0").font(10.5);
        assert!(in_framed_demo(&foot));

        // A scaled wrapper with no frame box under it, a frame box too small
        // to be a window (ascenix.co's 174x65 metric card), a wrapper that is
        // not in the frame range, one caught mid-animation, and a frame of
        // unknown size keep their severity.
        let (_t, body) = Tree::new();
        let bare = body.add("div").rect(0.0, 0.0, 600.0, 400.0).style("scale", "0.85");
        assert!(!in_framed_demo(&bare.add("div").rect(0.0, 0.0, 300.0, 200.0).add("span").text("Ready")));
        let (_t, body) = Tree::new();
        let small = body.add("div").rect(0.0, 0.0, 600.0, 400.0).style("scale", "0.6");
        let card = framed(small.add("div").rect(0.0, 0.0, 174.0, 65.0));
        assert!(!in_framed_demo(&card.add("span").text("Previous period")));
        for (prop, value) in [("scale", "0.9"), ("transform", "matrix(0.95, 0, 0, 0.95, 0, 0)"), ("scale", "0.2")] {
            let (_t, body) = Tree::new();
            let w = body.add("div").rect(0.0, 0.0, 600.0, 400.0).style(prop, value);
            let f = framed(w.add("div").rect(0.0, 0.0, 400.0, 300.0));
            assert!(!in_framed_demo(&f.add("span").text("Ready")), "{prop}: {value}");
        }
        let (_t, body) = Tree::new();
        let moving = body.add("div").rect(0.0, 0.0, 600.0, 400.0).style("scale", "0.85").with(|r| r.running = true);
        let f = framed(moving.add("div").rect(0.0, 0.0, 400.0, 300.0));
        assert!(!in_framed_demo(&f.add("span").text("Ready")));
        let (_t, body) = Tree::new();
        let w = body.add("div").rect(0.0, 0.0, 600.0, 400.0).style("scale", "0.85");
        let unknown = framed(w.add("div"));
        assert!(!in_framed_demo(&unknown.add("span").text("Ready")));
        // The frame box is the text's own box: not passed on the way up.
        let (_t, body) = Tree::new();
        let w = body.add("div").rect(0.0, 0.0, 600.0, 400.0).style("scale", "0.85");
        let own = framed(w.add("div").rect(0.0, 0.0, 400.0, 300.0)).text("Starter plan");
        assert!(!in_framed_demo(&own));
        // A control and a carousel slide between the text and the wrapper.
        let (_t, body) = Tree::new();
        let w = body.add("div").rect(0.0, 0.0, 600.0, 400.0).style("scale", "0.8");
        let slide = framed(w.add("div").class("swiper-slide").rect(0.0, 0.0, 400.0, 300.0));
        assert!(!in_framed_demo(&slide.add("span").text("Jane Doe")));
    }

    #[test]
    fn a_frame_turned_and_scaled_down() {
        // suitemigration.com's hero deck: an `app-screen` card turned 12
        // degrees at a scale of 0.78.
        let deck = "matrix(0.762955, -0.162171, 0.162171, 0.762955, -466.4, 106)";
        let (_t, body) = Tree::new();
        let screen = body
            .add("div")
            .rect(-52.0, 640.0, 393.0, 343.0)
            .style("transform", deck)
            .style("borderRadius", "16px")
            .style("boxShadow", "rgba(16, 24, 40, 0.38) 0px 26px 60px -28px");
        let inner = framed(screen.add("div").rect(-44.0, 675.0, 384.0, 307.0).add("div").rect(-25.0, 706.0, 335.0, 186.0));
        assert!(in_framed_demo(&inner));
        assert!(is_demo_frame(&screen));
        // A polaroid fanned at full size, a turned box not drawn as a frame,
        // a turn under 3 degrees and a skewed card keep their severity.
        for (transform, frame) in [
            ("matrix(0.978148, -0.207912, 0.207912, 0.978148, 0, 0)", true),
            ("rotate(-6deg)", true),
            (deck, false),
            ("rotate(2deg) scale(0.78)", true),
            ("matrix(0.78, 0, 0.2, 0.78, 0, 0)", true),
        ] {
            let (_t, body) = Tree::new();
            let card = body.add("div").rect(0.0, 0.0, 320.0, 360.0).style("transform", transform);
            let card = if frame {
                card.style("borderRadius", "12px").style("boxShadow", "rgba(0, 0, 0, 0.2) 0px 8px 24px")
            } else {
                card
            };
            let quote = card.add("p").text("Best tool we bought this year").font(10.0);
            assert!(!in_framed_demo(&quote), "{transform}, framed: {frame}");
        }
        // The turn and the scale may come from `transform`, `rotate` and
        // `scale` in any mix; the turn is read whole either way.
        for (props, demo) in [
            (&[("rotate", "10deg"), ("scale", "0.78")][..], true),
            (&[("transform", "rotate(10deg)"), ("scale", "0.78")][..], true),
            (&[("transform", "rotate(2deg)"), ("scale", "0.78")][..], false),
            (&[("rotate", "2deg"), ("scale", "0.78")][..], false),
            (&[("rotate", "1deg"), ("transform", "rotate(1.5deg) scale(0.78)")][..], false),
        ] {
            let (_t, body) = Tree::new();
            let mut card = framed(body.add("div").rect(0.0, 0.0, 320.0, 360.0));
            for (k, v) in props {
                card = card.style(k, v);
            }
            let quote = card.add("p").text("Best tool we bought this year").font(10.0);
            assert_eq!(in_framed_demo(&quote), demo, "{props:?}");
        }
        // A wrapper that turns as well as scales is not read as a stage.
        for props in [&[("transform", "rotate(12deg)"), ("scale", "0.8")][..], &[("rotate", "12deg"), ("scale", "0.8")][..]] {
            let (_t, body) = Tree::new();
            let mut w = body.add("div").rect(0.0, 0.0, 600.0, 400.0);
            for (k, v) in props {
                w = w.style(k, v);
            }
            let win = framed(w.add("div").rect(0.0, 0.0, 400.0, 300.0));
            assert!(!in_framed_demo(&win.add("span").text("Ready")), "{props:?}");
            assert!(!is_demo_frame(&win), "{props:?}");
        }
    }

    #[test]
    fn legal_block_markers_are_the_strict_tier() {
        for name in [
            "footnote-3",
            "homepage-footnotes__item",
            "LegalFooterSection__content",
            "footer-disclaimers",
            "disclaimers",
            "disclaimer-banner",
            "carrier-disclosures",
            "footer-disclosures",
            "hpPriceDisclosures",
            "fine-print",
            "smallPrint",
        ] {
            assert_eq!(fine_print_marker(name), FinePrint::Exempt, "{name}");
        }
        // A singular `disclosure` is also the name of an expand/collapse
        // widget, and a `footnote` after a type-scale word is a type size.
        for name in [
            "copyright",
            "offer-terms",
            "terms-links",
            "site-copyright_notice",
            "disclosure__panel",
            "styles_menuDisclosure__x1",
            "osano-cm-disclosure__toggle",
            "text-footnote",
            "upl-type-footnote",
            "fsFootnote",
        ] {
            assert_eq!(fine_print_marker(name), FinePrint::Advisory, "{name}");
        }
        for name in ["illegal-moves", "testimonials", "footer", "notes"] {
            assert_eq!(fine_print_marker(name), FinePrint::No, "{name}");
        }
        // One strict token among weaker ones settles it.
        assert_eq!(fine_print_marker("terms legal"), FinePrint::Exempt);
    }

    #[test]
    fn fine_print_tiers() {
        let (_t, body) = Tree::new();
        let body = body.font(12.0);
        // A footnote list item two levels up (apple's `li#footnote-3 > p`).
        let li = body.add("ol").add("li").with(|r| r.id = "footnote-3".into());
        let p = li.add("p").text("Trade-in values vary based on the condition, year and configuration.");
        assert_eq!(fine_print(&p), FinePrint::Exempt);
        // A `small` inside a disclaimer banner: the walk climbs past the
        // `small` to the marker (mercury's `#disclaimer-banner > small > p`).
        let banner = body.add("div").with(|r| r.id = "disclaimer-banner".into());
        let p = banner.add("small").add("p").text("Mercury is a fintech company, not an FDIC-insured bank.");
        assert_eq!(fine_print(&p), FinePrint::Exempt);
        // Weaker evidence stays advisory: a bare `small`, `terms`,
        // `copyright` and a leading mark with no marker around it.
        let small = body.add("div").add("small").text("Use 8 or more characters with a number and a symbol.");
        assert_eq!(fine_print(&small), FinePrint::Advisory);
        let terms = body.add("p").class("offer-terms").text("Monthly price reflects the net monthly payment.");
        assert_eq!(fine_print(&terms), FinePrint::Advisory);
        let credit = body.add("p").class("copyright").text("Photograph by the studio, used with permission.");
        assert_eq!(fine_print(&credit), FinePrint::Advisory);
        let star = body.add("p").text("* for free flu shot: select vaccines are no cost with most insurance.");
        assert_eq!(fine_print(&star), FinePrint::Advisory);
        // The strict tier keeps every gate of the advisory one: size,
        // heading, label, a control.
        let big = body.add("p").class("disclaimer-intro").font(16.0).text("Read these disclosures before you open an account.");
        assert_eq!(fine_print(&big), FinePrint::No);
        let h = body.add("h4").class("disclaimers").text("Disclaimers and footnotes");
        assert_eq!(fine_print(&h), FinePrint::No);
        let consent = body.add("div").class("disclaimer").add("label").text("I agree to receive the newsletter.");
        assert_eq!(fine_print(&consent), FinePrint::No);
        let far = body.add("div").class("legal-page");
        let deep = far.add("div").add("div").add("div").add("p").text("You agree to the following terms of service.");
        assert_eq!(fine_print(&deep), FinePrint::No);
        // An accordion panel under a strict marker is demoted, not dropped:
        // the marked box is a `details`, or holds an `aria-expanded` toggle.
        let acc = body.add("details").class("footer-footnote-accordion");
        let p = acc.add("p").text("Rates apply to new customers and may change at any time.");
        assert_eq!(fine_print(&p), FinePrint::Advisory);
        let faq = body.add("div").class("legal-faq");
        faq.add("button").attr("aria-expanded", "true").text("How do refunds work?");
        let p = faq.add("div").add("p").text("Refunds go back to the card you paid with.");
        assert_eq!(fine_print(&p), FinePrint::Advisory);
        // An inner marker does not hide the marked accordion around it.
        let acc = body.add("details").class("footer-footnote-accordion");
        acc.add("summary").text("Rates");
        let p = acc.add("p").class("footnote").text("Rates apply to new customers and may change at any time.");
        assert_eq!(fine_print(&p), FinePrint::Advisory);
        // Should-flag twin: the same inner marker under a plain box is exempt.
        let p = body.add("div").add("p").class("footnote").text("Rates apply to new customers and may change at any time.");
        assert_eq!(fine_print(&p), FinePrint::Exempt);
    }

    #[test]
    fn a_policy_pages_body_stays_advisory() {
        let long = "We keep account data for as long as your account stays open. ".repeat(60);
        // A policy page: the legal box holds the page's text, outside a footer.
        let (_t, body) = Tree::new();
        let body = body.font(14.0);
        body.add("h1").font(32.0).text("Privacy policy");
        let p = body.add("div").class("legal-content").add("p").text(&long);
        assert_eq!(fine_print(&p), FinePrint::Advisory);
        // The same block in a footer is a legal block.
        let (_t, body) = Tree::new();
        let body = body.font(14.0);
        let p = body.add("footer").add("div").class("legal-content").add("p").text(&long);
        assert_eq!(fine_print(&p), FinePrint::Exempt);
        // A short legal block on a page is a legal block.
        let (_t, body) = Tree::new();
        let body = body.font(14.0);
        let p = body.add("div").class("legal-content").add("p").text("Offer subject to credit approval.");
        assert_eq!(fine_print(&p), FinePrint::Exempt);
        // A long legal block under half of the page's text is a block too.
        let (_t, body) = Tree::new();
        let body = body.font(14.0);
        body.add("main").add("p").font(16.0).text(&long.repeat(2));
        let p = body.add("div").class("disclaimers").add("p").text(&long);
        assert_eq!(fine_print(&p), FinePrint::Exempt);
        // A marked paragraph inside a marked policy body: the outer box
        // settles it.
        let (_t, body) = Tree::new();
        let body = body.font(14.0);
        body.add("h1").font(32.0).text("Privacy policy");
        let policy = body.add("div").class("legal-content");
        let p = policy.add("p").class("legal-paragraph").text("Offer subject to credit approval.");
        policy.add("p").class("legal-paragraph").text(&long);
        assert_eq!(fine_print(&p), FinePrint::Advisory);
        // A hidden copy of the policy is not page text.
        let (_t, body) = Tree::new();
        let body = body.font(14.0);
        body.add("h1").font(32.0).text("Privacy policy");
        let p = body.add("div").class("legal-content").add("p").text(&long);
        body.add("div").attr("hidden", "").class("legal-content-mobile").add("p").text(&long);
        assert_eq!(fine_print(&p), FinePrint::Advisory);
        // A `hidden` policy that author CSS reveals is page text: it keeps
        // the policy-page demotion.
        let (_t, body) = Tree::new();
        let body = body.font(14.0);
        body.add("h1").font(32.0).text("Privacy policy");
        let shown = body.add("div").attr("hidden", "").class("legal-content").style("display", "block");
        let p = shown.add("p").text(&long);
        assert_eq!(fine_print(&p), FinePrint::Advisory);
        // Should-flag twin: the same copy left visible is half the page, and
        // the policy is a block on it.
        let (_t, body) = Tree::new();
        let body = body.font(14.0);
        body.add("h1").font(32.0).text("Privacy policy");
        let p = body.add("div").class("legal-content").add("p").text(&long);
        body.add("div").class("legal-content-mobile").add("p").text(&long);
        assert_eq!(fine_print(&p), FinePrint::Exempt);
    }

    #[test]
    fn fine_print_is_marked_or_opens_with_a_mark() {
        let (_t, body) = Tree::new();
        let body = body.font(12.0);
        let list = body.add("ul").class("disclaimers");
        let p = list.add("li").add("p").text("Offer available while supplies last. Terms apply.");
        assert!(is_fine_print(&p));
        let by_id = body.add("div").with(|r| r.id = "card-61-legal_Legal".into()).add("span").text("Req. 0% APR 36-mo. agrmt.");
        assert!(is_fine_print(&by_id));
        let small = body.add("small").text("Prices exclude tax and may change without notice.");
        assert!(is_fine_print(&small));
        let star = body.add("p").text("* for free flu shot: select vaccines are no cost with most insurance.");
        assert!(is_fine_print(&star));
        let dagger = body.add("p").text("†Trade-in values vary by condition, year and configuration of the device.");
        assert!(is_fine_print(&dagger));
        let noted = body.add("p").text("Battery life varies by use, configuration and many other factors.").with(|r| r.tail = true);
        noted.add("sup").text("1");
        assert!(is_fine_print(&noted));
        // Unmarked copy, a marker too far up, a marked page wrapper, a
        // consent label, a block with a checkbox, a form hint and a heading.
        let plain = body.add("p").text("Every plan includes unlimited projects and guests.");
        assert!(!is_fine_print(&plain));
        let far = body.add("div").class("legal-page");
        let deep = far.add("div").add("div").add("div").add("p").text("You agree to the following terms of service.");
        assert!(!is_fine_print(&deep));
        let (_t2, body2) = Tree::new();
        let main = body2.font(12.0).add("main").class("legal");
        assert!(!is_fine_print(&main.add("p").text("You agree to the following terms of service.")));
        let consent = body.add("div").class("disclaimer").add("label").text("I agree to receive the newsletter.");
        assert!(!is_fine_print(&consent));
        let boxed = body.add("p").class("legal").text("I agree to the terms.");
        boxed.add("input");
        assert!(!is_fine_print(&boxed));
        // A checkbox wrapped in a styled box beside the statement.
        let row = body.add("div").class("legal");
        row.add("span").class("box").add("input").attr("type", "checkbox");
        let statement = row.add("span").text("I agree to the terms of sale.");
        assert!(!is_fine_print(&statement));
        let required = body.add("p").text("* Indicates a required field in this form");
        assert!(!is_fine_print(&required));
        let h = body.add("h3").class("legal").text("Legal notice");
        assert!(!is_fine_print(&h));
        // A legal document set at body size is read.
        let rules = body.add("div").class("legal-body").add("section").add("p").font(17.0);
        let rules = rules.text("The contest is an ongoing, skill-based contest conducted in a series of rounds.");
        assert!(!is_fine_print(&rules));
    }

    #[test]
    fn pills_and_eyebrows_beside_a_heading() {
        let (_t, body) = Tree::new();
        let card = body.add("div");
        let pill = card.add("span").text("Popular").font(10.0);
        card.add("h3").text("Premium").font(18.0);
        assert!(is_micro_label(&pill));
        // An eyebrow above a wrapped heading.
        let head = body.add("div");
        let eyebrow = head.add("span").text("What's Inside").font(10.0);
        head.add("div").add("h2").text("Formula & Benefits").font(36.0);
        assert!(is_micro_label(&eyebrow));
        // A pill above an untagged title.
        let tier = body.add("div");
        let flag = tier.add("span").text("Most popular").font(10.0);
        tier.add("div").text("Pro").font(19.0);
        assert!(is_micro_label(&flag));
        // A wrapper that holds only the pill still sits beside the heading.
        let wrap_card = body.add("div");
        let inner = wrap_card.add("div").add("span").text("New").font(10.0);
        wrap_card.add("h3").text("Reports").font(20.0);
        assert!(is_micro_label(&inner));
        // A note that closes one block is not the next heading's eyebrow.
        let flow = body.add("div");
        flow.add("p").text("Selected work").font(16.0);
        let note = flow.add("span").text("tick").font(8.0);
        flow.add("h3").text("The next block").font(18.0);
        assert!(!is_micro_label(&note));
        // After its heading a label is a subtitle, unless drawn as a pill.
        let plan = body.add("div");
        plan.add("h3").text("Enterprise").font(20.0);
        let sub = plan.add("div").text("committed volume").font(10.0);
        assert!(!is_micro_label(&sub));
        let badge = plan
            .add("span")
            .text("Best value")
            .font(9.0)
            .style("borderRadius", "9999px")
            .style("backgroundColor", "rgb(230, 240, 255)");
        // The pill's previous sibling is the subtitle, not the heading.
        assert!(!is_micro_label(&badge));
        let head = body.add("div");
        head.add("h3").text("Pro").font(20.0);
        let after = head
            .add("span")
            .text("Best value")
            .font(9.0)
            .style("borderRadius", "9999px")
            .style("backgroundColor", "rgb(230, 240, 255)");
        assert!(is_micro_label(&after));
        // A card whose only text is the label, under a section heading.
        let section = body.add("div");
        section.add("h2").text("Fails").font(20.0);
        let shot = section.add("div");
        shot.add("div");
        let only = shot.add("div").add("span").text("Ready").font(9.0);
        assert!(!is_micro_label(&only));
        // No heading beside it, a paragraph beside it, a price, a discount,
        // a sentence, a link, a nav item, a form hint and a table cell.
        let lone = body.add("div");
        let label = lone.add("p").text("Also included").font(10.0);
        lone.add("div").add("span").text("Multi-step sequences").font(12.0);
        assert!(!is_micro_label(&label));
        let para = body.add("div");
        let kicker = para.add("div").text("Noticed on its own").font(10.5);
        para.add("p").text("Four tickets have gone 48 hours with no reply from anyone on the team.").font(17.5);
        assert!(!is_micro_label(&kicker));
        for (text, why) in [
            ("From $9", "price"),
            ("Save 20%", "discount"),
            ("Ends soon.", "sentence"),
            ("September 17", "date"),
            ("4 hand-overs", "count"),
        ] {
            let c = body.add("div");
            let l = c.add("span").text(text).font(10.0);
            c.add("h3").text("Premium").font(18.0);
            assert!(!is_micro_label(&l), "{why}");
        }
        for tag in ["a", "button", "nav", "form", "label", "td"] {
            let c = body.add("div");
            let l = c.add(tag).add("span").text("Popular").font(10.0);
            c.add("h3").text("Premium").font(18.0);
            assert!(!is_micro_label(&l), "{tag}");
        }
    }

    #[test]
    fn units_and_steps_beside_a_number() {
        let (_t, body) = Tree::new();
        let item = body.add("div");
        item.add("strong").text("05").font(16.0);
        let unit = item.add("span").text("Days").font(10.0);
        assert!(is_micro_label(&unit));
        // A label under a stat set large is what the stat means.
        let fleet = body.add("div");
        fleet.add("div").text("1-3").font(30.0);
        assert!(!is_micro_label(&fleet.add("div").text("Truck Fleets").font(10.0)));
        // A stat's label is what the number means, not its unit.
        let stat = body.add("div");
        stat.add("strong").text("10,000").font(32.0);
        let users = stat.add("span").text("Customers").font(10.0);
        assert!(!is_micro_label(&users));
        // A unit beside a number set no larger is running text.
        let flat = body.add("div");
        flat.add("span").text("5").font(10.0);
        assert!(!is_micro_label(&flat.add("span").text("min").font(10.0)));
        let step = body.add("div");
        let num = step.add("span").text("01").font(10.5);
        step.add("span").text("Connect your inbox").font(15.5);
        assert!(is_micro_label(&num));
        // A count beside a label is read, and so is a step in a button.
        let inbox = body.add("div");
        let count = inbox.add("span").text("3").font(10.0);
        inbox.add("span").text("Inbox").font(15.0);
        assert!(!is_micro_label(&count));
        let row = body.add("button");
        let in_btn = row.add("span").text("01").font(10.5);
        row.add("span").text("Triage this morning's queue").font(15.5);
        assert!(!is_micro_label(&in_btn));
    }

    #[test]
    fn ticks_and_axis_labels_inside_a_chart() {
        let (_t, body) = Tree::new();
        let chart = body.add("div").class("revenue-chart");
        let tick = chart.add("div").add("span").text("Q3").font(9.0);
        assert!(is_micro_label(&tick));
        // A caption drawn over a sibling canvas.
        let cell = body.add("div");
        cell.add("canvas").rect(790.0, 48.0, 418.0, 116.0);
        let hz = cell.add("span").text("60 Hz display").font(9.5).rect(1126.0, 147.0, 74.0, 11.0);
        assert!(is_micro_label(&hz));
        // The same label beside the canvas, not over it.
        let beside = cell.add("span").text("60 Hz display").font(9.5).rect(790.0, 200.0, 74.0, 11.0);
        assert!(!is_micro_label(&beside));
        // A run of absolutely placed labels lined up along an axis.
        let cal = body.add("div");
        let mut ticks = Vec::new();
        for (i, t) in ["7 am", "Noon", "6 pm"].iter().enumerate() {
            ticks.push(
                cal.add("span")
                    .class("t")
                    .text(t)
                    .font(9.5)
                    .style("position", "absolute")
                    .rect(97.0, 100.0 + 130.0 * i as f64, 40.0, 16.0),
            );
        }
        assert!(is_micro_label(&ticks[0]));
        // Two labels are not an axis, and neither is a row of static tags.
        let pair = body.add("div");
        let a = pair.add("span").class("t").text("Low").font(9.0).style("position", "absolute").rect(0.0, 0.0, 30.0, 12.0);
        pair.add("span").class("t").text("High").font(9.0).style("position", "absolute").rect(0.0, 90.0, 30.0, 12.0);
        assert!(!is_micro_label(&a));
        let tags = body.add("div");
        let first = tags.add("span").class("tag").text("How-To").font(10.0).rect(0.0, 0.0, 40.0, 14.0);
        for i in 1..4 {
            tags.add("span").class("tag").text("Hot Take").font(10.0).rect(50.0 * i as f64, 0.0, 40.0, 14.0);
        }
        assert!(!is_micro_label(&first));
        // A chart's title is longer than a tick.
        let long = chart.add("span").text("Revenue by quarter, all regions").font(10.0);
        assert!(!is_micro_label(&long));
    }
}
