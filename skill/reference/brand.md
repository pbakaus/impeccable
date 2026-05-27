# Brand register

When design IS the product: brand sites, landing pages, marketing surfaces, campaign pages, portfolios, long-form content, about pages. The deliverable is the design itself; a visitor's impression is the thing being made.

The register spans every genre. A tech brand (Stripe, Linear, Vercel). A luxury brand (a hotel, a fashion house). A consumer product (a restaurant, a travel site, a CPG packaging page). A creative studio, an agency portfolio, a band's album page. They all share the stance (*communicate, not transact*) and diverge wildly in aesthetic. Don't collapse them into a single look.

## The brand slop test

If someone could look at this and say "AI made that" without hesitation, it's failed. The bar is distinctiveness; a visitor should ask "how was this made?", not "which AI made this?"

Brand isn't a neutral register. AI-generated landing pages have flooded the internet, and average is no longer findable. Restraint without intent now reads as mediocre, not refined. Brand surfaces need a POV, a specific audience, a willingness to risk strangeness. Go big or go home.

**The second slop test: aesthetic lane.** Before committing to moves, name the reference. A Klim-style specimen page is one lane; Stripe-minimal is another; Liquid-Death-acid-maximalism is another. Don't drift into editorial-magazine aesthetics on a brief that isn't editorial. A hiking brand with Cormorant italic drop caps has the wrong register within the register.

Then the inverse test: in one sentence, describe what you're about to build the way a competitor would describe theirs. If that sentence fits the modal landing page in the category, restart.

## Typography

### Font selection procedure

Every project. Never skip. <!-- rule:brand-typo-font-selection-procedure -->

1. Read the brief. Write three concrete brand-voice words. Not "modern" or "elegant," but "warm and mechanical and opinionated" or "calm and clinical and careful." Physical-object words.
2. List the three fonts you'd reach for by reflex. If any appear in the reflex-reject list below, reject them; they are training-data defaults and they create monoculture.
3. Browse a real catalog (Google Fonts, Pangram Pangram, Future Fonts, Adobe Fonts, ABC Dinamo, Klim, Velvetyne) with the three words in mind. Find the font for the brand as a *physical object*: a museum caption, a 1970s terminal manual, a fabric label, a cheap-newsprint children's book, a concert poster, a receipt from a mid-century diner. Reject the first thing that "looks designy."
4. Cross-check. "Elegant" is not necessarily serif. "Technical" is not necessarily sans. "Warm" is not Fraunces. If the final pick lines up with the original reflex, start over.

### Reflex-reject list

Training-data defaults. Ban list. Look further: <!-- rule:brand-typo-reflex-reject-fonts -->

Fraunces · Newsreader · Lora · Crimson · Crimson Pro · Crimson Text · Playfair Display · Cormorant · Cormorant Garamond · Syne · IBM Plex Mono · IBM Plex Sans · IBM Plex Serif · Space Mono · Space Grotesk · Inter · DM Sans · DM Serif Display · DM Serif Text · Outfit · Plus Jakarta Sans · Instrument Sans · Instrument Serif

### Reflex-reject aesthetic lanes

Parallel to the font list. Currently saturated aesthetic families that have flooded brand surfaces. If a brief lands in one of these lanes without a register reason that *requires* it (a literal magazine, a literal terminal, a literal industrial signage system), it's the second-order training reflex: the trap one tier deeper than picking a Fraunces font. Look further. <!-- rule:brand-typo-reflex-reject-lanes -->

- **Editorial-typographic.** Display serif (often italic) + small mono labels + ruled separators + monochromatic restraint. Klim-influenced, magazine-cover affectation. By 2026, every Stripe-adjacent and Notion-adjacent brand has landed here. The fingerprint: three rule-separated columns, an italic Fraunces / Recoleta / Newsreader headline, lowercase track-spaced metadata, no imagery.

(More entries land here on the same cadence the font list updates. Brutalist-utility and acid-maximalism may join when they saturate. Removing entries when they fall back below saturation is also fine.)

The reflex-reject lists apply to **new design choices**. When the existing brand has already committed to a font or a lane as part of its identity, identity-preservation wins; variants on an existing surface don't second-guess what's already shipping. The reflex-reject lists are for greenfield decisions and for departure-mode variants in [live.md](live.md).

### Pairing and voice

Distinctive + refined is the goal. The specific shape depends on the brand, not on the brand's category. A category ("restaurant", "dev tool", "magazine", "fintech") is not a recipe; treating it as one is the first-order reflex SKILL.md warns against. <!-- rule:brand-typo-pairing-voice -->

Two families minimum is the rule *only* when the voice needs it. A single well-chosen family with committed weight/size contrast is stronger than a timid display+body pair.

### Scale

Modular scale, fluid `clamp()` for headings, ≥1.25 ratio between steps. Flat scales (1.1× apart) read as uncommitted. <!-- rule:brand-typo-modular-scale -->

Light text on dark backgrounds: add 0.05–0.1 to line-height. Light type reads as lighter weight and needs more breathing room. <!-- rule:brand-typo-light-on-dark-leading -->

## Color

Brand surfaces have permission for Committed, Full palette, and Drenched strategies. Use them. A single saturated color spread across a hero is not excess; it's voice. A beige-and-muted-slate landing page ignores the register. <!-- rule:brand-color-strategy-permission -->

- Name a real reference before picking a strategy. "Klim Type Foundry #ff4500 orange drench", "Stripe purple-on-white restraint", "Liquid Death acid-green full palette", "Mailchimp yellow full palette", "Condé Nast Traveler muted navy restraint", "Vercel pure black monochrome". Unnamed ambition becomes beige. <!-- rule:brand-color-named-reference -->
- Palette IS voice. A calm brand and a restless brand should not share palette mechanics. <!-- rule:brand-color-palette-is-voice -->
- When the strategy is Committed or Drenched, color carries the brand. Don't hedge with neutrals around the edges. Commit. <!-- rule:brand-color-commit-no-hedge -->
- Don't converge across projects. If the last brand surface was restrained-on-cream, this one is not. <!-- rule:brand-color-no-converge -->
- When a cultural-symbol palette is the obvious pull, reach past it. Let the cultural reading come from typography, imagery, and copy, not the palette. <!-- rule:brand-color-no-cultural-symbol -->

## Layout

- Asymmetric compositions are one option. Break the grid intentionally for emphasis. <!-- rule:brand-layout-asymmetric -->
- Fluid spacing with `clamp()` that breathes on larger viewports. Vary for rhythm: generous separations, tight groupings. <!-- rule:brand-layout-fluid-spacing -->
- For image-led briefs (hotels, restaurants, magazines, photography), full-bleed hero imagery with overlaid menu and centered headline is a canonical move; let the photograph be the design. <!-- rule:brand-layout-image-led-hero -->
- When cards ARE the right affordance, use `grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))` for breakpoint-free responsiveness. <!-- rule:brand-layout-cards-when-right -->

## Imagery

Brand surfaces lean on imagery. A restaurant, hotel, magazine, or product landing page without any imagery reads as incomplete, not as restrained. A solid-color rectangle where a hero image should go is worse than a representative stock photo.

**When the brief implies imagery (restaurants, hotels, magazines, photography, hobbyist communities, food, travel, fashion, product), you must ship imagery.** Zero images is a bug, not a design choice. "Restraint" is not an excuse. If the approved comp or brief is image-led, ship real project assets, generated raster assets, or a credible canvas/SVG/WebGL scene. Do not replace photographic, architectural, product, or place imagery with generic CSS panels, decorative diagrams, cards, bullets, or copy. <!-- rule:brand-imagery-required -->

- **For greenfield work without local assets, use stock imagery.** Unsplash is the default. The URL shape is `https://images.unsplash.com/photo-{id}?auto=format&fit=crop&w=1600&q=80`. **Verify the URLs before referencing them.** If you have an image-search MCP, web-fetch tool, or browser access, use it to find real photo IDs and confirm they resolve. Guessed IDs (even ones that look real) often 404 and ship as broken-image placeholders. Without a verification path, pick fewer photos you're confident exist over more that you guessed; never substitute colored `<div>` placeholders. <!-- rule:brand-imagery-unsplash-default -->
- **Search for the brand's physical object**, not the generic category: "handmade pasta on a scratched wooden table" beats "Italian food"; "cypress trees above a limestone hotel facade at dusk" beats "luxury hotel". <!-- rule:brand-imagery-physical-object-search -->
- **One decisive photo beats five mediocre ones.** Hero imagery should commit to a mood; padding with more stock doesn't rescue an indecisive one. <!-- rule:brand-imagery-one-decisive-photo -->
- **Alt text is part of the voice.** "Coastal fettuccine, hand-cut, served on the terrace" beats "pasta dish". <!-- rule:brand-imagery-alt-text -->

"Imagery" here is broader than stock photography: product screenshots, custom data visualizations, generated SVG, and canvas/WebGL scenes are all imagery. Text-only pages where typography alone carries the entire visual weight are the failure mode.

## Motion

- One well-orchestrated page-load beats scattered micro-interactions, when the brand invites it. Some brands skip entrance motion entirely; the restraint is the voice. <!-- rule:brand-motion-one-page-load -->

## Brand bans (on top of the shared absolute bans)

- Monospace as lazy shorthand for "technical / developer." If the brand isn't technical, mono reads as costume. <!-- rule:brand-ban-mono-as-shorthand -->
- Large rounded-corner icons above every heading. Screams template. <!-- rule:brand-ban-large-rounded-icons -->
- Single-family pages that picked the family by reflex, not voice. (A single family chosen deliberately is fine.) <!-- rule:brand-ban-single-family-by-reflex -->
- All-caps body copy. Reserve caps for short labels and headings. <!-- rule:brand-ban-all-caps-body -->
- Timid palettes and average layouts. Safe = invisible. <!-- rule:brand-ban-timid-palettes -->
- Zero imagery on a brief that implies imagery (restaurant, hotel, food, travel, fashion, photography, hobbyist). Colored blocks where a hero photo belongs. <!-- rule:brand-ban-zero-imagery -->
- Defaulting to editorial-magazine aesthetics (display serif + italic + drop caps + broadsheet grid) on briefs that aren't magazine-shaped. Editorial is ONE aesthetic lane, not the default brand aesthetic. <!-- rule:brand-ban-editorial-default -->
- Repeated tiny uppercase tracked labels above every section heading. A single strong kicker can be voice; repeating it as section grammar is AI scaffolding unless it's a deliberate, named brand system. <!-- rule:brand-ban-repeated-section-kickers -->

## Brand permissions

Brand can afford things product can't. Take them.

- Ambitious first-load motion. Reveals and typographic choreography that earn their place; not fade-on-scroll for every section. <!-- rule:brand-permission-first-load-motion -->
- Single-purpose viewports. One dominant idea per fold, long scroll, deliberate pacing. <!-- rule:brand-permission-single-purpose-viewports -->
- Unexpected color strategies. Palette IS voice; a calm brand and a restless brand should not share palette mechanics. <!-- rule:brand-permission-unexpected-color -->
- Art direction per section. Different sections can have different visual worlds if the narrative demands it. Consistency of voice beats consistency of treatment. <!-- rule:brand-permission-art-direction -->
