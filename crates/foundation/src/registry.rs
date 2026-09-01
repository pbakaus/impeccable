//! Port of `cli/engine/registry/antipatterns.mjs`: the rule registry, in
//! source order, with every field the JS objects carry.

/// One `ANTIPATTERNS` entry. Optional fields are `None` where the JS object
/// has no such key; `advisory` is `true` only where the JS has
/// `advisory: true`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Antipattern {
    pub id: &'static str,
    pub category: &'static str,
    /// JS `scopes` (e.g. `['type']`).
    pub scopes: Option<&'static [&'static str]>,
    /// JS `severity` (`'error'`, `'advisory'`); `finding()` defaults it to
    /// `'warning'` when absent.
    pub severity: Option<&'static str>,
    /// JS `advisory: true`.
    pub advisory: bool,
    pub name: &'static str,
    pub description: &'static str,
    /// JS `skillSection`.
    pub skill_section: Option<&'static str>,
    /// JS `skillGuideline`.
    pub skill_guideline: Option<&'static str>,
}

/// JS `ANTIPATTERNS`, in registry order.
pub static ANTIPATTERNS: &[Antipattern] = &[
    Antipattern {
        id: "side-tab",
        category: "slop",
        scopes: None,
        severity: None,
        advisory: false,
        name: "Side-tab accent border",
        description: "Thick colored border on one side of a card — the most recognizable tell of AI-generated UIs. Use a subtler accent or remove it entirely.",
        skill_section: Some("Visual Details"),
        skill_guideline: Some("colored accent stripe"),
    },
    Antipattern {
        id: "border-accent-on-rounded",
        category: "slop",
        scopes: None,
        severity: None,
        advisory: false,
        name: "Border accent on rounded element",
        description: "Thick accent border on a rounded card — the border clashes with the rounded corners. Remove the border or the border-radius.",
        skill_section: Some("Visual Details"),
        skill_guideline: Some("colored accent stripe"),
    },
    Antipattern {
        id: "overused-font",
        category: "slop",
        scopes: Some(&["type"]),
        severity: None,
        advisory: false,
        name: "Overused font",
        description: "Inter, Roboto, Fraunces, Geist, Plus Jakarta Sans, and Space Grotesk are used on so many sites they no longer feel distinctive. Each new wave of AI-generated UIs converges on the same handful of faces. Choose a face that gives your interface personality.",
        skill_section: Some("Typography"),
        skill_guideline: Some("overused fonts like Inter"),
    },
    Antipattern {
        id: "flat-type-hierarchy",
        category: "slop",
        scopes: Some(&["type"]),
        severity: None,
        advisory: false,
        name: "Flat type hierarchy",
        description: "Font sizes are too close together — no clear visual hierarchy. Use fewer sizes with more contrast (aim for at least a 1.25 ratio between steps).",
        skill_section: Some("Typography"),
        skill_guideline: Some("flat type hierarchy"),
    },
    Antipattern {
        id: "gradient-text",
        category: "slop",
        scopes: None,
        severity: None,
        advisory: false,
        name: "Gradient text",
        description: "Gradient text is decorative rather than meaningful — a common AI tell, especially on headings and metrics. Use solid colors for text.",
        skill_section: Some("Color & Contrast"),
        skill_guideline: Some("gradient text for"),
    },
    Antipattern {
        id: "ai-color-palette",
        category: "slop",
        scopes: None,
        severity: None,
        advisory: false,
        name: "AI color palette",
        description: "Purple/violet gradients and cyan-on-dark are the most recognizable tells of AI-generated UIs. Choose a distinctive, intentional palette.",
        skill_section: Some("Color & Contrast"),
        skill_guideline: Some("AI color palette"),
    },
    Antipattern {
        id: "cream-palette",
        category: "slop",
        scopes: None,
        severity: None,
        advisory: false,
        name: "Cream / beige palette",
        description: "A warm cream or beige page background has become the default \"tasteful\" AI surface, reached for by reflex. Choose a background that comes from a deliberate palette, not the safe warm off-white.",
        skill_section: Some("Color & Contrast"),
        skill_guideline: Some("cream and beige as the default surface"),
    },
    Antipattern {
        id: "nested-cards",
        category: "slop",
        scopes: Some(&["layout"]),
        severity: None,
        advisory: false,
        name: "Nested cards",
        description: "Cards inside cards create visual noise and excessive depth. Flatten the hierarchy — use spacing, typography, and dividers instead of nesting containers.",
        skill_section: Some("Layout & Space"),
        skill_guideline: Some("Nest cards inside cards"),
    },
    Antipattern {
        id: "monotonous-spacing",
        category: "slop",
        scopes: Some(&["layout"]),
        severity: None,
        advisory: false,
        name: "Monotonous spacing",
        description: "The same spacing value used everywhere — no rhythm, no variation. Use tight groupings for related items and generous separations between sections.",
        skill_section: Some("Layout & Space"),
        skill_guideline: Some("same spacing everywhere"),
    },
    Antipattern {
        id: "bounce-easing",
        category: "slop",
        scopes: None,
        severity: None,
        advisory: false,
        name: "Bounce or elastic easing",
        description: "Bounce and elastic easing feel dated and tacky. Real objects decelerate smoothly — use exponential easing (ease-out-quart/quint/expo) instead.",
        skill_section: Some("Motion"),
        skill_guideline: Some("bounce or elastic easing"),
    },
    Antipattern {
        id: "pulsing-dot",
        category: "slop",
        scopes: None,
        severity: None,
        advisory: false,
        name: "Pulsing status dot",
        description: "Small pulsing status dots simulate liveness decoratively. Reserve pulse animation for indicators tied to genuinely live, changing data; a static indicator with clear labeling is honest and calmer.",
        skill_section: Some("Motion"),
        skill_guideline: Some("decorative pulsing status dot"),
    },
    Antipattern {
        id: "blinking-cursor",
        category: "slop",
        scopes: None,
        severity: Some("advisory"),
        advisory: false,
        name: "Decorative blinking cursor",
        description: "A blinking text cursor animated into a hero or landing section simulates typing where no input exists. It borrows the dev-tool aesthetic as decoration. Real editable fields draw their own caret; anywhere else, let the composition hold attention without a fake prompt.",
        skill_section: Some("Motion"),
        skill_guideline: None,
    },
    Antipattern {
        id: "shape-assembled-illustration",
        category: "slop",
        scopes: None,
        severity: Some("advisory"),
        advisory: false,
        name: "Shape-assembled illustration",
        description: "A large inline SVG that builds a pictorial scene from a pile of primitive shapes reads as placeholder clip art, not illustration. Icons, logos, and data graphics are fine at their scale; a hero-sized visual deserves real artwork, a photograph, or a deliberately drawn graphic.",
        skill_section: Some("Imagery"),
        skill_guideline: None,
    },
    Antipattern {
        id: "organic-clip-path",
        category: "quality",
        scopes: None,
        severity: None,
        advisory: false,
        name: "Organic contour drawn as clip-path",
        description: "A clip-path polygon with many arbitrary vertices, or a curved clip-path path(), is CSS approximating a torn edge, blob, or silhouette. It reads as the cheap version of the effect and is usually a produced or photographic material replaced with code. Derive an alpha matte from the real image, or ship the shape as a cut-out raster; keep clip-path for geometry (cut corners, diagonals, hexagons).",
        skill_section: Some("Imagery"),
        skill_guideline: Some("geometric masks standing in for organic contours"),
    },
    Antipattern {
        id: "buried-raster",
        category: "quality",
        scopes: None,
        severity: None,
        advisory: false,
        name: "Raster buried under a wash or opacity",
        description: "A background image under a near-opaque gradient wash, or a raster on an element at near-zero opacity, never reaches the screen: the page shows the wash, and the produced texture or photo ships as a compliance token. Let the material show (a tint under 0.9 alpha, a blend mode, an opacity you can see) or remove the file.",
        skill_section: Some("Imagery"),
        skill_guideline: Some("a produced material must survive to the screen"),
    },
    Antipattern {
        id: "dark-glow",
        category: "slop",
        scopes: None,
        severity: None,
        advisory: false,
        name: "Glowing shadow accents",
        description: "Colored glow shadows — a zero-offset chromatic halo (box- or text-shadow) on any background, or any colored blurred shadow on a dark background — are the default \"cool\" look of AI-generated UIs. Use neutral elevation shadows and subtle, purposeful lighting instead.",
        skill_section: Some("Color & Contrast"),
        skill_guideline: Some("dark mode with glowing accents"),
    },
    Antipattern {
        id: "radial-halo",
        category: "slop",
        scopes: None,
        severity: None,
        advisory: false,
        name: "Radial-gradient background halo",
        description: "A chromatic radial-gradient wash — saturated at the center, fading to transparent — used as a decorative background glow on a dark page. Same tell as glowing shadows, drawn with a gradient instead of a shadow. Ground the surface with a solid or subtly shifted background instead.",
        skill_section: Some("Color & Contrast"),
        skill_guideline: Some("dark mode with glowing accents"),
    },
    Antipattern {
        id: "radial-spotlight-glow",
        category: "slop",
        scopes: None,
        severity: None,
        advisory: false,
        name: "Decorative radial spotlight glow",
        description: "A soft, low-opacity accent-colored radial gradient fading to transparent, dropped behind a hero or section as a \"spotlight.\" It is a reflex AI decoration — the translucent cousin of the saturated radial halo. Let the surface stand on its own, or light the composition with a deliberate material accent rather than a floating colored haze.",
        skill_section: Some("Color & Contrast"),
        skill_guideline: Some("dark mode with glowing accents"),
    },
    Antipattern {
        id: "marquee",
        category: "slop",
        scopes: None,
        severity: None,
        advisory: false,
        name: "Auto-scrolling marquee",
        description: "Continuously auto-scrolling content demands attention it has not earned and hides half its content at any moment. Reserve motion for content that changes; let readers move at their own pace.",
        skill_section: Some("Motion"),
        skill_guideline: Some("auto-scrolling marquee"),
    },
    Antipattern {
        id: "icon-tile-stack",
        category: "slop",
        scopes: Some(&["layout"]),
        severity: None,
        advisory: false,
        name: "Icon tile stacked above heading",
        description: "A small rounded-square icon container above a heading is the universal AI feature-card template — every generator outputs this exact shape. Try a side-by-side icon and heading, or let the icon sit in flow without its own container.",
        skill_section: Some("Typography"),
        skill_guideline: Some("large icons with rounded corners above every heading"),
    },
    Antipattern {
        id: "italic-serif-display",
        category: "slop",
        scopes: Some(&["type"]),
        severity: None,
        advisory: false,
        name: "Italic serif display headline",
        description: "Oversized italic serif (Fraunces, Recoleta, Playfair, Newsreader-italic) as the primary hero headline reads as taste in isolation but has become the universal AI-startup landing page hero. Set roman, or move to a non-serif display face. Editorial / magazine register may legitimately want this — judge by context.",
        skill_section: Some("Typography"),
        skill_guideline: Some("oversized italic serif as the hero headline"),
    },
    Antipattern {
        id: "hero-eyebrow-chip",
        category: "slop",
        scopes: Some(&["type"]),
        severity: None,
        advisory: false,
        name: "Hero eyebrow / pill chip",
        description: "A tiny uppercase letter-spaced label sitting immediately above an oversized hero headline — or the same shape rendered as a pill chip — is now the default AI SaaS hero. Drop the eyebrow, integrate the kicker into the headline, or run it as a navigation breadcrumb instead.",
        skill_section: Some("Typography"),
        skill_guideline: Some("tiny uppercase tracked label above the hero headline"),
    },
    Antipattern {
        id: "kicker-above-heading",
        category: "slop",
        scopes: Some(&["type"]),
        severity: None,
        advisory: false,
        name: "Kicker / eyebrow label above heading",
        description: "A tiny tracked uppercase or small-caps label sitting as its own block directly above a heading is banned outright, repeated or not. Generated kickers never earn their place: the heading carries its own weight. Delete the label and let the heading speak; if the words matter, work them into the heading or the body.",
        skill_section: Some("Typography"),
        skill_guideline: Some("kicker or eyebrow labels above headings"),
    },
    Antipattern {
        id: "numbered-section-labels",
        category: "slop",
        scopes: Some(&["type"]),
        severity: Some("advisory"),
        advisory: false,
        name: "Tiny numbered section labels",
        description: "Small numeric index labels riding next to section headings, repeated section after section, are AI editorial scaffolding — a page numbering its own chapters instead of earning structure. Let hierarchy, content, and rhythm carry the sequence.",
        skill_section: Some("Layout & Space"),
        skill_guideline: Some("numbered section markers"),
    },
    Antipattern {
        id: "em-dash-overuse",
        category: "slop",
        scopes: None,
        severity: None,
        advisory: true,
        name: "Em-dash overuse",
        description: "Em-dash saturation in body copy is an AI cadence tell. Advisory only: humans use em-dashes legitimately, so this fires only on saturation — at least 8 em-dashes (— or --) at a density near one per 500 characters of body text — never on a long article that uses a few. Prefer commas, colons, periods, or parentheses.",
        skill_section: Some("Copy"),
        skill_guideline: Some("no em dashes"),
    },
    Antipattern {
        id: "marketing-buzzword",
        category: "slop",
        scopes: None,
        severity: None,
        advisory: false,
        name: "Marketing buzzword",
        description: "Generic SaaS phrases (streamline / empower / supercharge / world-class / enterprise-grade / next-generation / cutting-edge / etc) are instant AI tells. Pick a specific verb and noun that says what the product literally does.",
        skill_section: Some("Copy"),
        skill_guideline: Some("marketing buzzwords"),
    },
    Antipattern {
        id: "aphoristic-cadence",
        category: "slop",
        scopes: None,
        severity: None,
        advisory: false,
        name: "Aphoristic-cadence copy",
        description: "Three or more sections landing on a short rebuttal sentence (\"X. No Y.\" / \"X. Just Y.\") or a manufactured-contrast aphorism (\"Not a feature. A platform.\") reads as AI cadence, not voice. Once is fine; the pattern is the tell.",
        skill_section: Some("Copy"),
        skill_guideline: Some("aphoristic cadence"),
    },
    Antipattern {
        id: "oversized-h1",
        category: "slop",
        scopes: Some(&["type"]),
        severity: None,
        advisory: false,
        name: "Oversized hero headline",
        description: "A full-sentence headline set at display size ends up dominating the viewport, leaving no room for anything else above the fold. A punchy one- or two-word headline at that size is fine — the problem is a long headline blown up too large. Set long headlines smaller, or tighten the copy.",
        skill_section: Some("Typography"),
        skill_guideline: Some("long headline set at display size"),
    },
    Antipattern {
        id: "extreme-negative-tracking",
        category: "slop",
        scopes: Some(&["type"]),
        severity: None,
        advisory: false,
        name: "Crushed letter spacing",
        description: "Letter-spacing pulled tighter than the point where characters keep their own shapes costs legibility. Tighten display type optically, not destructively.",
        skill_section: Some("Typography"),
        skill_guideline: Some("letter spacing crushed past legibility"),
    },
    Antipattern {
        id: "broken-image",
        category: "quality",
        scopes: None,
        severity: None,
        advisory: false,
        name: "Broken or placeholder image",
        description: "<img> tags with empty src, missing src, or placeholder values ship as broken-image boxes. Use real images, generated assets, or remove the tag.",
        skill_section: Some("Imagery"),
        skill_guideline: Some("broken image references"),
    },
    Antipattern {
        id: "script-error",
        category: "quality",
        scopes: None,
        severity: Some("error"),
        advisory: false,
        name: "Uncaught script error on load",
        description: "A script threw an uncaught exception or failed to parse while the page loaded. Broken JavaScript silently kills reveals, interactions, and dynamic content, and can leave most of a page invisible. Fix the error before judging anything else.",
        skill_section: None,
        skill_guideline: None,
    },
    Antipattern {
        id: "content-hidden-at-rest",
        category: "quality",
        scopes: Some(&["layout"]),
        severity: Some("error"),
        advisory: false,
        name: "Content invisible at rest",
        description: "A large share of the page text sits at opacity 0 or visibility hidden even after every reveal handler had a chance to run. This is the failed-reveal signature: the content shipped but never becomes visible. Make content visible by default and let JavaScript enhance its entrance instead of gating its existence.",
        skill_section: None,
        skill_guideline: None,
    },
    Antipattern {
        id: "edge-flush-cards",
        category: "quality",
        scopes: Some(&["layout"]),
        severity: None,
        advisory: false,
        name: "Cards flush against the scroller edge",
        description: "Cards inside a horizontal scroller or tab panel sit flush against the container edge at rest while keeping a gutter on the other side, so their edges and rounded corners get cut off. Usually the panel is sized wider than its clip box. Keep a consistent inset on both sides.",
        skill_section: None,
        skill_guideline: None,
    },
    Antipattern {
        id: "text-occlusion",
        category: "quality",
        scopes: Some(&["layout"]),
        severity: None,
        advisory: false,
        name: "Text occluded by an overlapping element",
        description: "Text is painted under an opaque element or a second text run, so part of it cannot be read. A decorative box, a stacked layer, or an inline element with leaked padding lands on the words instead of beside them. Give overlapping layers room, or move the text out from under the layer above it.",
        skill_section: Some("Layout & Space"),
        skill_guideline: None,
    },
    Antipattern {
        id: "first-viewport-column-overflow",
        category: "quality",
        scopes: Some(&["layout"]),
        severity: None,
        advisory: false,
        name: "One column stretches the first viewport",
        description: "A multi-column opening section lets one column run far past the fold while its sibling fits in a single viewport, so the short column floats in dead space and the fold falls deep inside one section. Balance the columns, cap the tall one, or let the long content flow below the opening row.",
        skill_section: Some("Layout & Space"),
        skill_guideline: None,
    },
    Antipattern {
        id: "gray-on-color",
        category: "quality",
        scopes: None,
        severity: None,
        advisory: false,
        name: "Gray text on colored background",
        description: "Gray text looks washed out on colored backgrounds. Use a darker shade of the background color instead, or white/near-white for contrast.",
        skill_section: Some("Color & Contrast"),
        skill_guideline: Some("gray text on colored backgrounds"),
    },
    Antipattern {
        id: "low-contrast",
        category: "quality",
        scopes: None,
        severity: None,
        advisory: false,
        name: "Low contrast text",
        description: "Text does not meet WCAG AA contrast requirements (4.5:1 for body, 3:1 for large text). Increase the contrast between text and background.",
        skill_section: None,
        skill_guideline: None,
    },
    Antipattern {
        id: "layout-transition",
        category: "quality",
        scopes: None,
        severity: None,
        advisory: false,
        name: "Layout property animation",
        description: "Animating width, height, padding, or margin causes layout thrash and janky performance. Use transform and opacity instead, or grid-template-rows for height animations.",
        skill_section: Some("Motion"),
        skill_guideline: Some("Animate layout properties"),
    },
    Antipattern {
        id: "line-length",
        category: "quality",
        scopes: Some(&["type", "layout"]),
        severity: None,
        advisory: false,
        name: "Line length too long",
        description: "Text lines wider than ~80 characters are hard to read. The eye loses its place tracking back to the start of the next line. Add a max-width (65ch to 75ch) to text containers.",
        skill_section: Some("Layout & Space"),
        skill_guideline: Some("wrap beyond ~80 characters"),
    },
    Antipattern {
        id: "cramped-padding",
        category: "quality",
        scopes: Some(&["layout"]),
        severity: None,
        advisory: false,
        name: "Cramped padding",
        description: "Text is too close to the edge of its container. Two shapes: (1) an element with its own text where the padding is too low for the font size, and (2) a wrapper with text-bearing children and near-zero padding against a visible boundary (border, outline, or non-transparent background) — children land flush against the boundary line. Add at least 8px (ideally 12–16px) of padding inside bordered, outlined, or colored containers.",
        skill_section: Some("Layout & Space"),
        skill_guideline: Some("inside bordered or colored containers"),
    },
    Antipattern {
        id: "body-text-viewport-edge",
        category: "quality",
        scopes: Some(&["layout"]),
        severity: None,
        advisory: false,
        name: "Body text touching viewport edge",
        description: "Body paragraphs render flush against the left or right viewport edge with no container providing horizontal padding. Wrap content in a container with at least 16px (ideally 24-32px) of horizontal padding, or apply max-width with mx-auto.",
        skill_section: None,
        skill_guideline: None,
    },
    Antipattern {
        id: "tight-leading",
        category: "quality",
        scopes: Some(&["type"]),
        severity: None,
        advisory: false,
        name: "Tight line height",
        description: "Line height below 1.3x the font size makes multi-line text hard to read. Use 1.5 to 1.7 for body text so lines have room to breathe.",
        skill_section: None,
        skill_guideline: None,
    },
    Antipattern {
        id: "skipped-heading",
        category: "quality",
        scopes: Some(&["type"]),
        severity: None,
        advisory: false,
        name: "Skipped heading level",
        description: "Heading levels should not skip (e.g. h1 then h3 with no h2). Screen readers use heading hierarchy for navigation. Skipping levels breaks the document outline.",
        skill_section: None,
        skill_guideline: None,
    },
    Antipattern {
        id: "heading-rhythm",
        category: "quality",
        scopes: Some(&["layout", "type"]),
        severity: None,
        advisory: false,
        name: "Heading crowded against the previous block",
        description: "A heading binds to the content it introduces, so the rendered space above it should exceed the space below it. When headings across a page sit as close or closer to the block above than to their own content, every section reads as if it captions the previous one. Open up the space above each heading.",
        skill_section: Some("Layout & Space"),
        skill_guideline: None,
    },
    Antipattern {
        id: "justified-text",
        category: "quality",
        scopes: Some(&["type"]),
        severity: None,
        advisory: false,
        name: "Justified text",
        description: "Justified text without hyphenation creates uneven word spacing (\"rivers of white\"). Use text-align: left for body text, or enable hyphens: auto if you must justify.",
        skill_section: None,
        skill_guideline: None,
    },
    Antipattern {
        id: "tiny-text",
        category: "quality",
        scopes: Some(&["type"]),
        severity: None,
        advisory: false,
        name: "Tiny body text",
        description: "Body text below 12px is hard to read, especially on high-DPI screens. Use at least 14px for body content, 16px is ideal.",
        skill_section: None,
        skill_guideline: None,
    },
    Antipattern {
        id: "undersized-ui-text",
        category: "quality",
        scopes: Some(&["type"]),
        severity: None,
        advisory: false,
        name: "Undersized functional text",
        description: "Interactive and content-bearing UI text (links, buttons, nav items, labels, table cells, meta rows, timecodes) below 11px is a legibility failure, not a style choice. WCAG sets no absolute pixel floor, but functional text under 11px is a defensible quality bar: it fails on high-DPI and small viewports and it degrades tap and read targets. The 11px floor holds even inside a footer; only non-interactive legal smallprint gets the softer 10px floor. Being ON the DESIGN.md size ramp does not exempt a value here: adding 8px to the ramp launders the token but not the legibility problem, and that is exactly the escape hatch this rule closes. Exempts sup/sub, visually-hidden (sr-only) text, and code/terminal contexts. Decorative letterspaced micro-labels are still functional and stay in scope.",
        skill_section: None,
        skill_guideline: None,
    },
    Antipattern {
        id: "all-caps-body",
        category: "quality",
        scopes: Some(&["type"]),
        severity: None,
        advisory: false,
        name: "All-caps body text",
        description: "Long passages in uppercase are hard to read. We recognize words by shape (ascenders and descenders), which all-caps removes. Reserve uppercase for short labels and headings.",
        skill_section: Some("Typography"),
        skill_guideline: Some("long body passages in uppercase"),
    },
    Antipattern {
        id: "wide-tracking",
        category: "quality",
        scopes: Some(&["type"]),
        severity: None,
        advisory: false,
        name: "Wide letter spacing on body text",
        description: "Letter spacing above 0.05em on body text disrupts natural character groupings and slows reading. Reserve wide tracking for short uppercase labels only.",
        skill_section: None,
        skill_guideline: None,
    },
    Antipattern {
        id: "text-overflow",
        category: "quality",
        scopes: Some(&["layout"]),
        severity: None,
        advisory: false,
        name: "Content overflowing its container",
        description: "Content renders wider than its container, spilling out or forcing a horizontal scrollbar. Let text wrap, constrain widths, or give the region a deliberate scroll affordance.",
        skill_section: Some("Layout & Space"),
        skill_guideline: Some("content wider than its container"),
    },
    Antipattern {
        id: "repeated-container-text",
        category: "quality",
        scopes: None,
        severity: None,
        advisory: false,
        name: "Same text repeated inside one container",
        description: "The same literal text rendered three or more times in structurally different spots inside a single card or panel is redundant messaging — usually a status or label wired into every slot of a template. Say it once, in the slot where it matters most.",
        skill_section: None,
        skill_guideline: None,
    },
    Antipattern {
        id: "clipped-overflow-container",
        category: "quality",
        scopes: Some(&["layout"]),
        severity: None,
        advisory: false,
        name: "Positioned child clipped by overflow container",
        description: "A clipping container (overflow hidden or clip) wrapping an absolutely-positioned child cuts off tooltips, menus, and popovers that need to escape. Let the overflow be visible, or move the positioned layer out of the clip.",
        skill_section: Some("Layout & Space"),
        skill_guideline: Some("overflow container clipping positioned children"),
    },
    Antipattern {
        id: "design-system-font",
        category: "quality",
        scopes: Some(&["type"]),
        severity: None,
        advisory: false,
        name: "Font outside DESIGN.md",
        description: "A font is used that is not declared in DESIGN.md typography. Use the documented type system or update DESIGN.md if this is an intentional brand addition.",
        skill_section: Some("Typography"),
        skill_guideline: Some("font family outside the project design system"),
    },
    Antipattern {
        id: "design-system-color",
        category: "quality",
        scopes: None,
        severity: Some("advisory"),
        advisory: false,
        name: "Color outside DESIGN.md",
        description: "A literal color is outside the DESIGN.md palette and sidecar tonal ramps. This may be legitimate, but it should be an intentional design-system addition rather than drift.",
        skill_section: Some("Color & Contrast"),
        skill_guideline: Some("literal color outside the project design system"),
    },
    Antipattern {
        id: "design-system-radius",
        category: "quality",
        scopes: None,
        severity: Some("advisory"),
        advisory: false,
        name: "Radius outside DESIGN.md",
        description: "A border-radius value is outside the DESIGN.md rounded scale. Use a documented radius token or update the design system if the new shape is intentional.",
        skill_section: Some("Visual Details"),
        skill_guideline: Some("border radius outside the project design system"),
    },
    Antipattern {
        id: "design-system-font-size",
        category: "quality",
        scopes: Some(&["type"]),
        severity: Some("advisory"),
        advisory: false,
        name: "Font size outside DESIGN.md",
        description: "A literal font-size is off the type ramp documented in DESIGN.md typography. Use a documented size step or update the design system if the new step is intentional.",
        skill_section: Some("Typography"),
        skill_guideline: Some("font size outside the project design system"),
    },
    Antipattern {
        id: "gpt-thin-border-wide-shadow",
        category: "slop",
        scopes: None,
        severity: Some("advisory"),
        advisory: false,
        name: "Hairline border with wide shadow",
        description: "A hairline border paired with a wide, diffuse shadow is a recurring generated-UI signature. Commit to one — a defined edge or a soft elevation — rather than both at once.",
        skill_section: Some("Visual Details"),
        skill_guideline: Some("hairline border plus wide diffuse shadow"),
    },
    Antipattern {
        id: "repeating-stripes-gradient",
        category: "slop",
        scopes: None,
        severity: Some("advisory"),
        advisory: false,
        name: "Repeating-gradient stripes",
        description: "Repeating-gradient stripes used as surface decoration are a recurring generated-UI signature. Reach for a deliberate texture or leave the surface plain.",
        skill_section: Some("Visual Details"),
        skill_guideline: Some("repeating-gradient decorative stripes"),
    },
    Antipattern {
        id: "codex-grid-background",
        category: "slop",
        scopes: None,
        severity: Some("advisory"),
        advisory: false,
        name: "Decorative grid-line background",
        description: "A decorative grid or line-field background drawn with hairline linear-gradient layers tiled by a fixed pixel cell is a recurring generated-UI signature. Reserve grid overlays for actual canvas, map, blueprint, or measurement surfaces; elsewhere use product structure or a plain surface.",
        skill_section: Some("Visual Details"),
        skill_guideline: Some("two-axis grid-line gradient background"),
    },
    Antipattern {
        id: "theater-slop-phrase",
        category: "slop",
        scopes: None,
        severity: Some("advisory"),
        advisory: false,
        name: "Theater framing copy",
        description: "Dismissing something as \"theater\" is a recurring generated-copy tic. Say plainly what the thing does or does not do.",
        skill_section: Some("Copy"),
        skill_guideline: Some("theater framing copy"),
    },
    Antipattern {
        id: "image-hover-transform",
        category: "slop",
        scopes: None,
        severity: Some("advisory"),
        advisory: false,
        name: "Image hover transform",
        description: "Scaling or rotating an image on hover is a recurring generated-UI signature. Let imagery sit still, or use a subtler, purposeful interaction.",
        skill_section: Some("Motion"),
        skill_guideline: Some("image scale or rotate on hover"),
    },
];

/// JS `RULE_ENGINE_SUPPORT`.
pub const RULE_ENGINE_SUPPORT: &[(&str, &[&str])] = &[
    ("regex", &["source", "page-analyzer"]),
    ("static-html", &["element", "page"]),
    ("browser", &["element", "page", "layout"]),
    ("visual", &["visual-contrast"]),
];

/// JS `getAntipattern(id)`.
pub fn get_antipattern(id: &str) -> Option<&'static Antipattern> {
    ANTIPATTERNS.iter().find(|rule| rule.id == id)
}

/// JS `getAP(id)` from `findings.mjs` (an alias of `getAntipattern`).
pub fn get_ap(id: &str) -> Option<&'static Antipattern> {
    get_antipattern(id)
}

/// JS `ADVISORY_RULE_IDS`: ids of rules with `advisory: true`, in registry order.
pub fn advisory_rule_ids() -> impl Iterator<Item = &'static str> {
    ANTIPATTERNS
        .iter()
        .filter(|rule| rule.advisory)
        .map(|rule| rule.id)
}

/// JS `isAdvisoryRule(id)`.
pub fn is_advisory_rule(id: &str) -> bool {
    advisory_rule_ids().any(|r| r == id)
}

/// JS `getRulesForCategory(category)`.
pub fn get_rules_for_category(category: &str) -> Vec<&'static Antipattern> {
    ANTIPATTERNS
        .iter()
        .filter(|rule| rule.category == category)
        .collect()
}

/// JS `getRuleEngineSupport(engine)` (empty for an unknown engine).
pub fn get_rule_engine_support(engine: &str) -> &'static [&'static str] {
    RULE_ENGINE_SUPPORT
        .iter()
        .find(|(e, _)| *e == engine)
        .map(|(_, s)| *s)
        .unwrap_or(&[])
}

/// JS `RULE_SCOPES`: every scope tag declared by any rule, first-seen order.
pub fn rule_scopes() -> Vec<&'static str> {
    let mut out: Vec<&'static str> = Vec::new();
    for rule in ANTIPATTERNS {
        for scope in rule.scopes.unwrap_or(&[]) {
            if !out.contains(scope) {
                out.push(scope);
            }
        }
    }
    out
}

/// JS `filterByScopes(findings, scopes)`: keep findings whose rule declares
/// at least one requested scope; an empty scope list keeps everything.
pub fn filter_by_scopes<F, G>(findings: Vec<F>, scopes: &[&str], antipattern_of: G) -> Vec<F>
where
    G: Fn(&F) -> &str,
{
    if scopes.is_empty() {
        return findings;
    }
    findings
        .into_iter()
        .filter(|f| {
            get_antipattern(antipattern_of(f))
                .and_then(|rule| rule.scopes)
                .unwrap_or(&[])
                .iter()
                .any(|scope| scopes.contains(scope))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_shape() {
        assert_eq!(ANTIPATTERNS.len(), 61);
        assert_eq!(ANTIPATTERNS[0].id, "side-tab");
        assert_eq!(rule_scopes(), vec!["type", "layout"]);
        assert!(is_advisory_rule("em-dash-overuse"));
        assert!(!is_advisory_rule("blinking-cursor"));
        assert_eq!(
            get_antipattern("blinking-cursor").unwrap().severity,
            Some("advisory")
        );
        assert_eq!(
            get_rule_engine_support("browser"),
            &["element", "page", "layout"]
        );
        assert!(get_rule_engine_support("nope").is_empty());
        let ids: std::collections::HashSet<&str> = ANTIPATTERNS.iter().map(|r| r.id).collect();
        assert_eq!(ids.len(), ANTIPATTERNS.len());
    }
}
