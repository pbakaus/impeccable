---
name: Impeccable
description: Neo kinpaku system. Two brand anchors, kinpaku gold and verdigris patina, sit on dark warm-black lacquer. Restraint in chrome, brilliance in texture.

# All values below mirror site/styles/kinpaku-tokens.css verbatim. That file
# is the source of truth; this frontmatter is the portable export. If a token
# changes there, update both.
colors:
  # Brand anchors
  kinpaku-gold: "oklch(84% 0.19 80.46)"       # primary accent
  verdigris-patina: "oklch(70% 0.12 188)"     # secondary accent / state

  # Surfaces
  lacquer-black: "oklch(7% 0.006 95)"         # page ground
  lacquer-deep: "oklch(4% 0.004 95)"          # deepest inset
  raised-lacquer: "oklch(11% 0.006 95)"       # panels and inputs
  graphite: "oklch(15% 0.008 95)"             # inactive states
  graphite-2: "oklch(19% 0.008 95)"           # one step up from graphite

  # Text
  champagne: "oklch(91% 0 0)"                 # headlines, <strong> — neutral white (name kept for compat)
  text-warm: "oklch(88% 0 0)"                 # body — neutral near-white
  text-muted: "oklch(72% 0 0)"                # captions, meta
  text-faint: "oklch(62% 0 0)"                # subdued
  text-mute-deep: "oklch(52% 0 0)"            # disabled

  # Neutral ramp and light-mode paper/ink tokens. These mirror html.light in
  # site/styles/kinpaku-tokens.css plus neutral utility stops used in docs and
  # the live overlay.
  neutral-100: "oklch(100% 0 0)"
  neutral-99: "oklch(99% 0 0)"
  neutral-98: "oklch(98% 0 0)"
  neutral-96: "oklch(96% 0 0)"
  neutral-94: "oklch(94% 0 0)"
  neutral-85: "oklch(85% 0 0)"
  neutral-80: "oklch(80% 0 0)"
  neutral-75: "oklch(75% 0 0)"
  neutral-55: "oklch(55% 0 0)"
  neutral-45: "oklch(45% 0 0)"
  neutral-35: "oklch(35% 0 0)"
  neutral-34: "oklch(34% 0 0)"
  neutral-30: "oklch(30% 0 0)"
  neutral-25: "oklch(25% 0 0)"
  neutral-24: "oklch(24% 0 0)"
  neutral-22: "oklch(22% 0 0)"
  light-paper: "oklch(97% 0.012 95)"
  light-paper-deep: "oklch(94% 0.014 95)"
  light-paper-raised: "oklch(99% 0.008 95)"
  light-graphite: "oklch(91% 0.012 95)"
  light-graphite-2: "oklch(88% 0.014 95)"
  light-ink: "oklch(18% 0.02 95)"
  light-text: "oklch(25% 0.018 95)"
  light-muted: "oklch(45% 0.015 95)"
  light-faint: "oklch(55% 0.012 95)"
  light-disabled: "oklch(65% 0.01 95)"
  light-rule: "oklch(25% 0.02 95)"

  # Gold ramp
  kinpaku-pale: "oklch(86% 0.07 84)"          # hover lift, pale fills
  kinpaku-rich: "oklch(77% 0.13 82)"          # active CTA, severity-medium
  kinpaku-deep: "oklch(61% 0.085 78)"         # borders against the brand
  kinpaku-rule: "oklch(78% 0.12 82)"          # alpha-friendly rule/glow base
  kinpaku-rule-rich: "oklch(77% 0.14 82)"     # secondary button soft fill base
  kinpaku-glint: "oklch(95% 0.04 84)"         # leaf texture highlight overlay
  kinpaku-glint-bright: "oklch(98% 0.04 84)"  # animated leaf sheen highlight
  kinpaku-glint-rich: "oklch(94% 0.07 82)"    # warmer leaf sheen edge
  kinpaku-glint-soft: "oklch(98% 0.035 84)"   # hover glint on gold CTAs
  gold-hairline: "oklch(78% 0 0 / 0.16)"      # default rule — neutral (name kept for compat)
  gold-hairline-strong: "oklch(74% 0.09 82 / 0.6)" # active rule — gold

  # Patina ramp
  patina-pale: "oklch(82% 0.07 188)"          # hover lift on patina
  patina-deep: "oklch(49% 0.08 188)"          # deep oxide, dark variants
  patina-rule: "oklch(70% 0.105 190)"         # alpha-friendly glow/rule base
  patina-text: "oklch(76% 0.088 190)"         # small readable patina text

  # Legacy command category colors still used by homepage proof modules.
  category-create-text: "oklch(86% 0.075 82)"
  category-evaluate-text: "oklch(76% 0.088 190)"
  category-refine-bg: "oklch(89% 0.055 84)"
  category-refine-border: "oklch(84% 0.055 84)"
  category-refine-text: "oklch(88% 0.047 84)"
  category-simplify-bg: "oklch(61% 0.085 78)"
  category-simplify-border: "oklch(70% 0.096 72)"
  category-simplify-text: "oklch(82% 0.095 76)"
  category-harden-border: "oklch(58% 0.085 185)"
  category-harden-text: "oklch(71% 0.082 184)"
  category-system-border: "oklch(58% 0.028 82)"
  category-system-text: "oklch(71% 0.028 82)"

  # Conventional terminal chrome. Used only for faux terminal window dots.
  terminal-red: "#ff5f56"
  terminal-yellow: "#ffbd2e"
  terminal-green: "#27c93f"

  # State (warning only, used sparingly)
  vermilion-warning: "oklch(58% 0.15 35)"
  vermilion-warning-light: "oklch(52% 0.16 35)"
  success: "oklch(45% 0.18 145)"
  success-on-paper: "oklch(40% 0.10 145)"
  success-bg: "oklch(58% 0.12 145)"
  success-border: "oklch(75% 0.12 145)"
  success-soft: "oklch(95% 0.05 145)"

typography:
  scale:
    # The enumerated type ramp, at a 16px root. Keys are the px value; values
    # are the rem form to author with. Every literal font-size in the codebase
    # lands on one of these steps, and the detector allows +/-0.5px around each,
    # so the px and rem spellings of a step are interchangeable.
    #
    # The named roles below pick from this ramp. The two fluid roles (display,
    # headline) are the exception: they interpolate between clamp endpoints and
    # are free to land between steps, which is what makes them fluid.
    #
    # Adding a step is a design decision, not a convenience. The tail this ramp
    # replaced had 86 distinct sizes, including six near-identical steps between
    # 13.7px and 15.4px that no reader could tell apart.
    "8": "0.5rem"        # decorative micro-type: badges, superscript markers
    "9": "0.5625rem"     # dense chrome, viz tick labels
    "10": "0.625rem"     # overline, smallest legible caps
    "11": "0.6875rem"    # eyebrow, badge, tag
    "12": "0.75rem"      # meta lines, table chrome, inline code
    "13": "0.8125rem"    # secondary UI text, card meta
    "14": "0.875rem"     # dense body, list rows, controls
    "15": "0.9375rem"    # long-form secondary text
    "16": "1rem"         # default body
    "18": "1.125rem"     # lead paragraph, card heading
    "20": "1.25rem"      # card and panel titles
    "24": "1.5rem"       # subsection heads
    "28": "1.75rem"      # section heads
    "32": "2rem"         # large section heads
    "40": "2.5rem"       # sub-display
    "48": "3rem"         # small display
    "56": "3.5rem"       # display
    "64": "4rem"         # large display
    "72": "4.5rem"       # hero display
    "80": "5rem"         # hero display, wide viewports
    "88": "5.5rem"       # largest hero display
  wordmark:
    # Alumni Sans (token --ks-font-wordmark), the same face as display, held
    # at weight 400 for the small brand lockup where the thin display cut
    # would read too light.
    fontFamily: "Alumni Sans, Albert Sans, Arial, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    letterSpacing: "0.15em"
    lineHeight: 1
  display:
    fontFamily: "Alumni Sans, Albert Sans, Arial, sans-serif"
    fontSize: "clamp(3.4rem, 6.5vw, 5.6rem)"
    fontWeight: 100
    letterSpacing: "-0.01em"
    lineHeight: 1.02
  headline:
    fontFamily: "Alumni Sans, Albert Sans, Arial, sans-serif"
    fontSize: "clamp(2.6rem, 4vw, 3.4rem)"
    fontWeight: 300
    letterSpacing: "0"
    lineHeight: 1.04
  title:
    fontFamily: "Albert Sans, Avenir Next, Helvetica Neue, Arial, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 500
    lineHeight: 1.35
  body:
    fontFamily: "Albert Sans, Avenir Next, Helvetica Neue, Arial, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.8
  eyebrow:
    fontFamily: "SFMono-Regular, Roboto Mono, Consolas, monospace"
    fontSize: "0.6875rem"
    fontWeight: 500
    letterSpacing: "0.18em"
  mono:
    fontFamily: "SFMono-Regular, Roboto Mono, Consolas, monospace"
    fontSize: "0.6875rem"
    fontWeight: 500
    letterSpacing: "0.22em"

rounded:
  none: "0"
  xs: "2px"
  code: "3px"
  sm: "4px"
  control-sm: "5px"
  md: "6px"
  control-md: "7px"
  lg: "8px"
  xl: "10px"
  "2xl": "12px"
  "3xl": "14px"
  "4xl": "16px"
  pill: "999px"

spacing:
  xs: "8px"
  sm: "16px"
  md: "24px"
  lg: "32px"
  xl: "48px"
  "2xl": "80px"
  "3xl": "112px"

components:
  button-primary:
    backgroundColor: "{colors.kinpaku-gold}"
    textColor: "{colors.lacquer-deep}"
    typography: "{typography.title}"
    rounded: "{rounded.xs}"
    padding: "0 38px"
  button-primary-hover:
    backgroundColor: "{colors.kinpaku-pale}"
    textColor: "{colors.lacquer-deep}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.kinpaku-gold}"
    borderColor: "{colors.gold-hairline-strong}"
    rounded: "{rounded.xs}"
    padding: "0 38px"
  input-text:
    backgroundColor: "{colors.lacquer-deep}"
    textColor: "{colors.champagne}"
    borderColor: "{colors.gold-hairline}"
    rounded: "{rounded.sm}"
    padding: "14px 16px"
  card:
    backgroundColor: "{colors.raised-lacquer}"
    textColor: "{colors.text-warm}"
    borderColor: "{colors.gold-hairline}"
    rounded: "{rounded.sm}"
    padding: "24px"
  nav-link:
    textColor: "{colors.champagne}"
    typography: "{typography.body}"
  nav-link-hover:
    textColor: "{colors.kinpaku-gold}"
  live-picker-bar:
    backgroundColor: "{colors.lacquer-deep}"
    textColor: "{colors.champagne}"
    borderColor: "{colors.kinpaku-gold}"
    rounded: "{rounded.sm}"
    padding: "4px 5px"
  live-picker-toggle-active:
    backgroundColor: "oklch(78% 0.12 82 / 0.18)"
    textColor: "{colors.kinpaku-gold}"
---

# Design System: Impeccable

## 1. Overview: Neo Kinpaku

**Creative North Star: "Neo Kinpaku"**

Impeccable is now a dark lacquer interface marked by Japanese gold leaf and precise technical geometry. The brand should feel like a crafted object: black urushi, irregular kinpaku seams, quiet measurement marks, circuit traces, and controlled verdigris oxidation. It is refined, technical, and physical.

This direction replaces the old warm-paper editorial system. No italic serif hero. No magenta accent. No generic AI-tool neon. The page should feel expensive and deliberate, but still useful: comparisons, command demos, live audit tables, and documentation modules remain the product proof.

**Key characteristics**

- Dark mineral and lacquer surfaces, never pure black.
- Kinpaku gold as the primary accent, with true leaf texture where an element carries brand weight.
- Verdigris patina as the secondary accent for state, contrast, and "improved" signals.
- A geometric sans voice with a widely tracked wordmark, not a serif editorial voice.
- Thin calibration lines, circuit geometry, and gold seams used as functional structure.
- Small radii, restrained borders, and almost no decorative shadow.

## 2. The Kit: One Vocabulary For Every Page

The site ships a global component kit at `site/styles/kinpaku-kit.css`, imported from `Base.astro` so every page gets it for free. The kit primitives are listed below. The live demos are on `/design-system`.

### The Kit Consumption Rule

When building a new page or refactoring an existing one, reach for a kit primitive before inventing a new class. Specifically:

- **Buttons**: use `.ks-button` + a variant (`.ks-button-primary`, `-secondary`, `-ghost`, `-disabled`). Do not write a new `.hero-cta-primary` / `.footer-cta` / `.section-action-button` class — those are the bespoke vocabularies the kit is meant to replace.
- **Grouping content**: use `.ks-bento` + `.ks-bento-tile` (with `--span-4` / `--span-6` / `--span-8` across a 12-column grid). This is the canonical answer to "how do I group 2-6 items without nesting cards?" Do not invent yet another card class.
- **Section scaffolding**: use `.ks-section` for the container, `.ks-section-head` for the header, `<h2>` inside that (the kit styles it), and `.ks-section-sub` for the subhead. Eyebrow above the h2 is optional via `.ks-section-eyebrow` — skip it on editorial walkthroughs where every-section eyebrows read as AI scaffolding.
- **Status, tags, toasts, modals, tooltips, empty states, pagination, skeletons, changelog rows**: use the kit primitive. Listed in the cheatsheet below.

Invent only when the kit truly doesn't cover the shape. When you do invent, flag it — a new pattern that solves a real recurring need belongs in the kit, not in page-specific CSS. Page CSS is for genuinely page-specific scenery (hero illustrations, unique editorial visuals), not for reinventing primitives the kit already has.

### What's In The Kit (cheatsheet)

Every class below is a global primitive. Drop it on any element on any page using `<Base.astro>`; the styles resolve through `kinpaku-tokens.css` so they inherit the current brand values automatically.

**Brand lockup**

- `.ks-brand` — wrapper for the brand mark + wordmark lockup (anchor or div).
- `.ks-mark` — the carved-tile glyph (a solid kinpaku square split by a diagonal slash), 38×38, no container border.
- `.ks-wordmark` — the IMPECCABLE wordmark text, solid Alumni Sans (`--ks-font-wordmark`), uppercase, weight 400, letter-spacing 0.15em.

**Section scaffolding**

- `.ks-section` — page-level section container, 1320px max-width, kit gutters.
- `.ks-section-head` — the section header block.
- `.ks-section-eyebrow` — small mono eyebrow above the h2 (optional).
- `.ks-section-head h2` — auto-styles any h2 inside `.ks-section-head` to the section title scale (weight 300, kit display family).
- `.ks-section-sub` — subhead paragraph below the h2.
- `.ks-subsection` — nested grouping inside a section.
- `.ks-subsection-label` — small mono label above a subsection's content.

**Buttons**

- `.ks-button.ks-button-primary` — filled kinpaku CTA, dark text. Both classes required.
- `.ks-button.ks-button-secondary` — outlined kinpaku CTA.
- `.ks-button.ks-button-ghost` — text-only kinpaku button.
- `.ks-button[disabled]` or `.ks-button.ks-button-disabled` — disabled state.
- `.ks-button-arrow` — wrapper for an arrow SVG inside a button (sized correctly).
- `.ks-button-row` — flex row helper for horizontal button groups.

**Form controls**

- `.ks-form-sample` — vertical form layout.
- `.ks-toggle` — switch (checkbox underneath, label visible).
- `.ks-checkbox` — checkbox with label.
- `.ks-select` — dropdown.

**Tabs**

- `.ks-tabs` — tab container.
- `.ks-tab-list` — tab buttons row.
- `.ks-tab-panel` — tab content panel.

**Status, tags, and feedback**

- `.ks-badge` + `.is-detected` / `.is-improved` / `.is-ready` — pill badge with dot.
- `.ks-badge-row` — flex row helper.
- `.ks-tag` + `.is-detected` / `.is-improved` / `.is-neutral` / `.is-ready` — slim tag, no dot.
- `.ks-tag-row` — flex row helper.
- `.ks-toast` + `.is-success` / `.is-warning` — alert toast with icon + dismiss.
- `.ks-toast-icon` / `.ks-toast-close` — inner parts.
- `.ks-modal` + `.ks-modal-actions` / `.ks-modal-close` — dialog box.
- `.ks-empty` + `.ks-empty-icon` — empty-state block.
- `.ks-skeleton` — loading shimmer.
- `.ks-pagination` — paged-list nav.
- `.ks-icon-button` + `.ks-tooltip` — circular icon button with hover tooltip.

**Containers**

- `.ks-bento` — 12-column grid with dark plinth + 8px gutters.
- `.ks-bento-tile` — single tile within a bento.
- `.ks-bento-tile--span-4` / `--span-6` / `--span-8` — sizing (e.g. 8/4, 6/6, 4/8).
- `.ks-bento-num` — tiny mono caps marker for tile numbering. Add `data-color="patina"` to flip to verdigris.

**Changelog**

- `.ks-changelog` — vertical list wrapper.
- `.ks-changelog-entry` — single dated entry.
- `.ks-changelog-date` — left-column date.
- `.ks-changelog-body` — right-column content. Use `<em>` inside `<strong>` for a small "NEW" badge.

### Tokens vs Classes

The kit primitives consume the tokens from `site/styles/kinpaku-tokens.css`. When you need a color, type scale value, easing, or rule alpha outside a kit primitive, read the token directly:

- Colors: `var(--ks-kinpaku)`, `var(--ks-patina)`, `var(--ks-lacquer)`, `var(--ks-champagne)`, etc.
- Type scale: `var(--ks-type-display-size)`, `var(--ks-type-headline-weight)`, etc.
- Rules: `var(--ks-rule)`, `var(--ks-rule-strong)`.
- Motion: `var(--ks-ease)`.

Do not hand-type oklch values or font sizes in page CSS. If a value isn't in the token file, it's either a token that needs adding or a sign that the visual moment is bespoke enough to live page-locally — either way, the decision needs to be deliberate.

## 3. Colors: Lacquer, Gold, Patina

### Ground and Surface

- **Lacquer Black** (`oklch(7% 0.006 95)`): Default page ground. It is warm and mineral, not neutral black.
- **Lacquer Deep** (`oklch(4% 0.004 95)`): Deepest inset surfaces and footer depth.
- **Raised Lacquer** (`oklch(11% 0.006 95)`): Panels, cards, demo frames, and dark UI surfaces.
- **Graphite** (`oklch(15% 0.008 95)`): Input fields, inactive tiles, and subtle internal surfaces.
- **Graphite 2** (`oklch(19% 0.008 95)`): One step above graphite; context pills, inactive chrome inside live mode bars.

### Gold System

- **Kinpaku Gold** (`oklch(84% 0.19 80.46)`): Primary accent. CTAs, active state, wordmark, key rules, command focus.
- **Kinpaku Rich** (`oklch(77% 0.13 82)`): Active CTA fill and severity-medium markers.
- **Kinpaku Deep** (`oklch(61% 0.085 78)`): Secondary gold for borders, subdued icons, and large technical diagrams.
- **Kinpaku Pale** (`oklch(86% 0.07 84)`): Hover lift and pale fills.
- **Default Hairline** (`oklch(78% 0 0 / 0.16)`): Default border and divider. Neutral, so borders and labels don't carry warmth (token name `gold-hairline` / `--ks-rule` is legacy).
- **Strong Gold Hairline** (`oklch(74% 0.09 82 / 0.6)`): Active borders, focus outlines, and structural anchors. Stays gold — this is where the hairline is meant to read as brand.

### Text

- **Champagne** (`oklch(91% 0 0)`): Headlines, `<strong>`, important labels. The brightest text tier, fully neutral (token name is legacy). Text carries no warmth at any tier; the gold accents and surfaces do.
- **Body Text** (`oklch(88% 0 0)`): Body copy on dark surfaces. Neutral and bright so reading copy reads crisp, not mushy.
- **Muted Text** (`oklch(72% 0 0)`): Metadata, captions, secondary labels.
- **Faint Text** (`oklch(62% 0 0)`): Subdued labels.
- **Mute Deep** (`oklch(52% 0 0)`): Disabled copy.

### Secondary and State

- **Verdigris Patina** (`oklch(70% 0.12 188)`): Secondary accent. Improved states, live indicators, hover emphasis, and contrast point.
- **Patina Pale** (`oklch(82% 0.07 188)`): Hover lift on patina surfaces.
- **Patina Deep** (`oklch(49% 0.08 188)`): Deep oxide. Background texture and dark patina variants.
- **Vermilion Warning** (`oklch(58% 0.15 35)`): Error or anti-pattern warning only. Use sparingly.

### Color Rules

**The Gold Carries Brand Rule.** Kinpaku gold is the primary brand signal. If a single accent must represent Impeccable, use gold, not magenta or cyan.

**The Patina Has Meaning Rule.** Verdigris is secondary. It marks improvement, live state, or contrast against gold. Do not use it as a generic decoration field.

**The Texture Budget Rule.** Leaf and patina textures are for brand-bearing moments: hero seams, CTA fills, dividers, major swatches, and select system modules. Generic cards stay mostly flat.

**The OKLCH-Only Rule.** New colors are declared in OKLCH. Hex appears only inside third-party examples or imported assets.

**The Gold-By-Size-On-Paper Rule (light mode).** On paper, gold usage is gated by size, not banned. **Large display accents stay gold** — the hero's gold accent word reads beautifully at display scale (see the Designing hero: "with Impeccable" in kinpaku gold on paper). But **at body and label sizes gold fails contrast on the bright ground, so it is never used for small accent text on paper.** There, the roles swap to verdigris: links, active nav, and inline command code use `--ks-link-on-paper` (patina-deep, `oklch(49% 0.08 188)`) for contrast, and small labels fall back to muted ink. Verdigris also carries state on paper (active nav, "you are here"), consistent with the Patina Has Meaning rule. Gold otherwise stays on fills and marks (logo, CTA fills, nodes, active rules). Reach for the light-mode tokens (`--ks-link-on-paper`, `--ks-nav-active`, the `light-*` surfaces) when building on paper — the token list below is dark-first, so a naive read pulls you toward gold *body* text that the light theme forbids.

## 4. Typography: Two faces, weight inversion at the top

**Display font:** Alumni Sans, Albert Sans, Arial, sans-serif (a thin hairline cut carries the brand at display sizes)
**Body and UI font:** Albert Sans, Avenir Next, Helvetica Neue, Arial, system-ui, sans-serif
**Mono font:** SFMono-Regular, Roboto Mono, Consolas, monospace

The voice is geometric and restrained. The Alumni Sans display face is reserved for the hero h1 and section h2s; the brand wordmark uses the same face at a heavier weight. Everything else (body, UI labels, controls, code) uses Albert Sans. The faces pair cleanly because they share humanist proportions without fighting for attention.

### Hierarchy

- **Wordmark**: Alumni Sans (`--ks-font-wordmark`), weight 400, uppercase, `1.3rem`, letter-spacing `0.15em`. Brand lockup only. The thin display cut reads too light at lockup size, so the wordmark holds weight 400.
- **Display · h1**: Alumni Sans, `clamp(3.4rem, 6.5vw, 5.6rem)`, **weight 100**, line-height 1.02, letter-spacing `-0.01em`. Hero and major statements.
- **Headline · h2**: Alumni Sans, `clamp(2.6rem, 4vw, 3.4rem)`, **weight 300**, line-height 1.04. Section titles.
- **Title · h3**: Albert Sans, `1.18rem`, weight 500, line-height 1.35. Component and panel headings.
- **Body**: Albert Sans, `1.02rem`, weight 400, line-height 1.8. Long copy on dark surfaces needs air.
- **Eyebrow**: Mono, `0.7rem`, weight 500, uppercase, letter-spacing `0.18em`. Small markers above titles.
- **Mono label**: Mono, `0.72rem`, letter-spacing `0.22em`. Category labels, nav metadata, table headers, audit lines.

### Typography Rules

**The Weight-Inversion Rule.** Section h2s read heavier (300) than the hero h1 (100). This is deliberate: the hero is elegant and thin so the page can breathe; section anchors carry more weight to ground each block. Do not normalize the two weights.

**The Two-Face Rule.** Display sizes use Alumni Sans — thin (100) for the h1, heavier (300) for h2s. Anything sized below `1.2rem` uses Albert Sans. The thin display cut reads too light at small sizes, so it never carries body or UI text.

**Tracked Labels Are Short Rule.** Tracked uppercase labels are for short system markers. Do not write full sentences in tracked caps.

**Dark Type Needs Air Rule.** Body text on lacquer uses line-height 1.65 to 1.8 and a max width of 65 to 75ch.

## 5. Elevation and Material

The system is mostly flat. Depth comes from material contrast, hairline borders, texture, and subtle inset light.

### Shadow Vocabulary

- **Panel Setback:** `0 24px 70px oklch(2% 0.004 95 / 0.42)` for large framed modules only.
- **CTA Lift:** `0 18px 48px oklch(2% 0.004 95 / 0.4)` plus a small inset highlight.
- **Patina Glow:** `0 0 22px oklch(70% 0.105 190 / 0.24)` for tiny live indicators only.
- **No Default Card Shadow:** Cards rest on borders and background shifts.

### Material Rules

**Hairline First Rule.** Use 1px gold hairlines before adding shadow.

**No Glass Rule.** Translucency can exist in overlays, but decorative blur/glass panels are not part of this system.

**Texture Needs Contrast Rule.** Text never sits directly on high-contrast leaf texture. Add a lacquer veil or move the texture to an edge.

**Asset-Led Material Rule.** Brand-bearing material accents use raster assets or generated images, not hand-drawn SVG approximations of leaf, dust, oxidation, or clockwork. Code-native geometry is reserved for simple hairlines, layout grids, and functional UI structure.

## 6. Components

### Buttons

- **Primary:** Kinpaku texture or gold fill, dark text, 1px border, 2px radius, min-height 58px.
- **Secondary:** Transparent lacquer, gold border, gold text. Use for secondary commands only.
- **Hover:** Slight upward transform, brighter gold position, or patina border. No bounce.
- **Focus:** Patina outline with a 4px offset.

### Hero Compare

The before/after comparison is a proof object. It uses a dark grid field, a straight kinpaku seam, a gold handle, and readable labels. The "before" side can show AI slop colors, but the frame itself stays in the neo-kinpaku system.

### Command Rail

The first-viewport rail should map to workflow or high-value commands, not abstract design categories. Items use full-width dark bands, gold icons, and patina hover state.

### Periodic Table

The command table uses dark category cells. Kinpaku covers Create, Refine, and Simplify variants; patina covers Evaluate and Harden; System is muted graphite. No light pastel category tints remain on the homepage.

### DESIGN.md Panel

The DESIGN.md visualization must show kinpaku as the primary color, patina as the secondary color, Alumni Sans and Albert Sans as the display and body families, and dark component samples. Magenta is not representative of the current system.

### Dividers and Material Accents

Dividers use real kinpaku, dust, or verdigris texture assets when they need to carry the brand. Simple CSS dividers are limited to straight hairlines. Avoid synthetic dot rails, fake dust strokes, or pseudo-circuit motifs that create rendering artifacts.

### Footer

The footer can carry the strongest oxidation accent. Use the gold seam plus patina edge as a final brand signature.

### Live Mode Picker

The global bottom bar and the contextual bar (configure / cycling / accept) share one chrome treatment. Source of truth: `skill/scripts/live-browser.js` (`barPaletteForTheme`, `initGlobalBar`, `initBar`). Homepage and `/live-mode` demos mirror it via `.live-demo-gbar` and `.live-demo-ctx` in `site/styles/kinpaku-kit.css`.

- **Surface:** Lacquer Deep (`oklch(4% 0.004 95)`), always. Picker chrome does not adapt to the host page's light/dark theme.
- **Border:** 1px solid neutral hairline (`oklch(92% 0 0 / 0.13)`), radius 8px. The bar reads as a quiet precise tool; gold is reserved for the brand mark and the active control, not the container outline.
- **Shadow:** `0 16px 36px -12px oklch(0% 0 0 / 0.6)` (tight neutral drop, no gold halo ring).
- **Brand mark:** Impeccable carved-tile icon (same SVG paths as `site/components/Header.astro` / `favicon.svg`), kinpaku fill on transparent ground. Not a "/" slash or rounded-square placeholder.
- **Default controls:** Champagne labels at rest (`oklch(84% 0.035 82)`), muted icons (`oklch(63% 0.024 82)`).
- **Active toggle:** Crisp graphite pill (`oklch(27% 0 0)`) with kinpaku text/icon. The gold carries the "selected" signal; the pill itself is neutral, not a kinpaku-dim wash.
- **Exit hover:** Vermilion (`oklch(58% 0.15 35)`), not a neutral gray lift.
- **Context bar internals:** Graphite-2 pills, gold hairline dividers, kinpaku Go/Accept CTAs with lacquer-deep text.
- **DESIGN.md toggle icon:** Four-quadrant swatch; bottom-right uses warm charcoal (`oklch(34% 0.014 82)`) so the tile reads against lacquer-deep, not void-black.

**The Picker Is Brand Rule.** Live mode UI is Impeccable product chrome, not host-page chrome. It always ships the lacquer-deep fill, the carved-tile mark, and gold on the mark + active control. Brand reads through the mark and the gold accent rather than a gold border ringing the bar; the container itself stays a quiet neutral-edged tool.

## 7. Do and Do Not

### Do

- Do use kinpaku gold as the primary brand color.
- Do use verdigris patina for secondary state and contrast.
- Do keep surfaces dark, warm, and mineral.
- Do use real texture assets for gold leaf and oxidation when the element is brand-bearing.
- Do use circuit/calibration geometry as structure, especially around product proof.
- Do keep cards compact, flat, and sharply bounded.
- Do preserve utility: demos, sliders, audit tables, command examples, docs, and pricing must remain understandable.
- Do keep live mode picker bars on lacquer-deep with kinpaku gold borders, regardless of host page theme.

### Do Not

- Do not use editorial magenta as a brand accent.
- Do not use italic serif display typography.
- Do not use purple gradients, neon cyan fields, glassmorphism, or generic AI-tool glow.
- Do not put gold texture under long text.
- Do not use beige, paper, or cream as the page ground **in the default (dark) theme**. (Light mode intentionally uses a warm paper ground — see the Gold-Is-A-Mark-On-Paper rule.)
- Do not add decorative calibration marks that do not align with real content.
- Do not use wide rounded cards or nested cards.
- Do not use pure black or pure white.
- Do not let the visual system hide the product proof.
- Do not theme-adapt live mode picker chrome to match arbitrary host pages. The picker is always neo-kinpaku.
