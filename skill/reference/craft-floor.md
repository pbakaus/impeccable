# Craft floor

Load this after the direction is settled, and build without announcing the checklist. A pinned brief or the committed visual world overrides anything here; your own habit does not. When the design hook is active it already enforces the mechanical checks below as you edit: act on its findings instead of re-auditing each rule. <!-- rule:skill-craft-floor -->

A wholesale file rewrite, after a hook block or an error recovery, starts by re-opening DESIGN.md and the token sheet, so the new file restates the recorded system rather than your memory of it; memory is where a display token becomes a hand-tuned clamp. The ranking lives in [new-work.md](new-work.md): the comp rules composition; the world rules material, and a rewrite changes neither. <!-- rule:skill-rebuild-from-the-record -->

## Verify

Each of these is a check on the built result, not an intention. Run them together in the batched inspection rounds, not as separate screenshot trips; the checks share one render.

- **Contrast:** body and placeholder text ≥4.5:1, large text ≥3:1. On colored surfaces tint secondary text from that hue or the foreground; never gray. <!-- rule:skill-color-verify-contrast -->
- **Depth:** shadows carry an offset and a soft blur. A zero-offset colored halo is decoration. <!-- rule:skill-color-no-glow-halo -->
- **Spacing:** tight groups, generous separation, more space above a heading than below it. Read the computed values. <!-- rule:skill-layout-spacing-rhythm -->
- **Type:** body measure 65–75ch, display max 6rem, tracking floor -0.04em, balanced headings, obvious scale and weight steps. Run the real copy at every breakpoint and fix what overflows. <!-- rule:skill-typo-floor --> <!-- rule:skill-ban-text-overflow -->
- **Motion:** one authored moment, not scattered effects and not one identical entrance on every section. Exponential ease-out from an already-visible default. Reach past transform and opacity: blur, backdrop-filter, clip-path, mask, and shadow belong to the palette when they stay smooth. <!-- rule:skill-motion-floor --> <!-- rule:skill-motion-materials-palette --> <!-- rule:skill-motion-no-section-fade -->
- **Tokens:** a size or color a step from a defined token takes the token: `0.82rem` beside a `0.8rem` token is the token, not a new size, and inline SVG or JS-drawn strokes take `var(--role)` or `currentColor`. Wire or remove what nothing consumes before finish; done means every defined custom property is consumed by at least one rule. <!-- rule:skill-tokens-are-consumed -->
- **States:** hover, disabled, loading, error, empty. Plus real content, working controls, responsive composition, keyboard focus. <!-- rule:skill-floor-shipping -->
- **Browser surfaces:** the parts you did not draw still carry the design. Text selection, the caret, custom scrollbars, focus rings, underline offset, and the numerals in tabular data all ship with browser defaults that belong to no design system. Theme them from the palette. This is the cheapest signal that a page was built rather than assembled, and the one models skip most reliably. <!-- rule:skill-craft-browser-surfaces -->
- **Copy:** the product's own language. Controls name their action; errors name the problem and the recovery. <!-- rule:skill-copy-design-material -->
- **Coverage:** every brief requirement present and findable within seconds. <!-- rule:skill-floor-brief-coverage -->

## Refuse

These are the category's defaults, not bans: the brief's own words can earn any of them. Reaching for one when the axis is free means you were not deciding; recognizing that means rewriting the element, not softening it.

Page scaffolds:

- Same-size cards of icon plus heading plus text as the page structure. Cards are the lazy container; nested cards are always wrong. <!-- rule:skill-ban-identical-card-grids --> <!-- rule:skill-layout-cards-lazy -->
- The hero-metric template: big number, small label, supporting stats, accent. <!-- rule:skill-ban-hero-metric -->
- A kicker or eyebrow above a heading. This one is a ban, not a default: no brief earns it back. The heading carries its own weight; delete the label and let the heading speak. <!-- rule:skill-ban-eyebrow-on-every-section -->
- Section numbers (01 / 02 / 03) unless the sequence itself carries information the reader needs. <!-- rule:skill-ban-numbered-section-markers -->
- A modal for a task that needs neither interruption nor protected focus. <!-- rule:skill-reflex-modal-by-reflex -->

Surface habits:

- Gradient text. Emphasis comes from weight or size. <!-- rule:skill-ban-gradient-text -->
- Glass and blur as decoration rather than as a specific effect. <!-- rule:skill-ban-glassmorphism-default -->
- A colored `border-left` or `border-right` above 1px on cards, list items, callouts, or alerts. <!-- rule:skill-ban-side-stripe-borders -->
- Hard offset shadows (`box-shadow: 4px 4px 0`) outside a world that is actually neobrutalist. The zero-blur block shadow is a costume, not a depth system; a world that did not choose it never earns it as a default. <!-- rule:skill-ban-hard-offset-shadow -->
- Sparklines, progress rings, and soft-shadowed rounded rectangles standing in for content. <!-- rule:skill-reflex-decorative-chrome -->
- Monospace as a costume for "technical" rather than for code, data, or measurement. <!-- rule:skill-reflex-mono-as-technical -->
- A system display face (Impact, Arial Black, the platform sans) as the display voice of an own-world page. Source and self-host a face whose character matches the approved lettering; the closest installed font is a failure, not a fallback. <!-- rule:skill-ban-system-display-face -->
- Unicode glyphs or emoji standing in for an icon system. Icons are drawn, from a real library or authored SVG, in one consistent stroke and weight. When a pack icon fails to fetch, take the nearest icon from the same pack, jsDelivr as the fallback CDN; drawing a replacement from scratch is an exception the user signs off on, so the one-pack promise survives a failed fetch. <!-- rule:skill-ban-glyph-icons -->
- Geometric masks standing in for organic contours. A circle, polygon, or radial-gradient cutout approximating a photographic subject's edge is the cheap version of the effect and reads worse than omitting it. Derive an alpha matte from the actual image, or produce a cut-out asset. <!-- rule:skill-ban-geometric-occlusion-mask -->
- Light or dark picked by category. Pick it from the use scene: who, where, under what ambient light. <!-- rule:skill-reflex-theme-by-habit -->

<codex>
- Tracking stops at -0.04em. -0.02 to -0.03em usually reads better. <!-- rule:skill-typo-codex-tracking-repeat -->
- Declare elevation once, border or shadow. A 1px border under a wide soft shadow is the ghost card. Card radii stay at 12–16px; pills are for small controls. <!-- rule:skill-codex-elevation-radius --> <!-- rule:skill-ban-codex-ghost-card --> <!-- rule:skill-ban-codex-over-round -->
- Real illustration or none. Sketch-style SVG scenes, `loose-sketch` / `doodle` class names, and `feTurbulence` grain read as amateur. This bans SVG imitating pictures, never SVG doing geometry: crisp vector shapes, diagrams, animated linework, and shader-driven effects remain first-class media. A shaded, perspectived, or figure-bearing illustration is a picture even in line-art style; geometry means shapes a session can specify exactly. <!-- rule:skill-ban-codex-sketchy-svg -->
- Backgrounds are surfaces, textured only from the subject's world. `repeating-linear-gradient` stripes and two-axis grid overlays need an actual canvas, map, blueprint, or measuring tool under them. <!-- rule:skill-ban-codex-stripes --> <!-- rule:skill-ban-codex-grid-backgrounds -->
- Claims and configuration come from supplied truth; label illustrative values honestly. Naming a concept and then ironizing it is not a claim. <!-- rule:skill-codex-material-honesty --> <!-- rule:skill-ban-codex-x-theater -->
</codex>

<gemini>
Never animate an image on hover, directly or through its parent. It is not an action target. Give the container the feedback. <!-- rule:skill-interaction-gemini-no-image-hover -->
</gemini>

The floor holds the mechanics; it never picks the direction. With every check green, spend the page on the committed world, and when torn between refined and committed, commit. <!-- rule:skill-floor-not-ceiling -->
