---
name: Lumina
description: Editorial-warm landing page for an AI-native workflow tool.
colors:
  cream: "#faf6ef"
  cream-warm: "#f4ebdc"
  peach: "#f6dfcb"
  line: "#e6dccb"
  ink: "#1f1a15"
  soft: "#5b4f44"
  accent: "#c8552b"
  accent-deep: "#a8431f"
typography:
  display:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "clamp(3rem, 7vw, 5.5rem)"
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "clamp(2.25rem, 4.5vw, 3.25rem)"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "1.375rem"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  lede:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.16em"
rounded:
  card: "20px"
  icon: "14px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "16px"
  md: "24px"
  lg: "32px"
  xl: "56px"
  2xl: "80px"
  3xl: "120px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.cream}"
    rounded: "{rounded.pill}"
    padding: "14px 28px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "14px 28px"
  nav-pill:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.cream}"
    rounded: "{rounded.pill}"
    padding: "9px 18px"
  card:
    backgroundColor: "{colors.cream-warm}"
    textColor: "{colors.soft}"
    rounded: "{rounded.card}"
    padding: "40px 32px"
  icon-tile:
    backgroundColor: "{colors.cream}"
    rounded: "{rounded.icon}"
    size: "56px"
---

# Design System: Lumina

## 1. Overview

**Creative North Star: "Editorial confidence in warm light."**

The system reads as a printed magazine spread, transposed to a screen. Cream paper as the page surface, ink-dark headlines in Fraunces, restrained pacing carried by whitespace. Density is mid. The accent (a burnt orange warming toward the lower stop of the cream-to-peach hero gradient) appears sparingly: on the eyebrow chip, the logo dot, and the italic emphasis inside the hero headline. Nowhere else.

What the system explicitly rejects, per PRODUCT.md anti-references: glassmorphism, dark mode with neon glow, gradient text, side-stripe accents on cards, and the broader "Fraunces-cream-peach SaaS template" that this very page exemplifies. The DESIGN.md documents the current visual reality so the live-mode design panel can render it accurately. The brand intent is to diffuse away from it.

**Key Characteristics:**
- Warm-paper palette anchored on cream (#faf6ef)
- Display in Fraunces, body in Inter
- Editorial-leaning layout vocabulary
- Rounded throughout (14px, 20px, 999px)
- Flat: no shadows, depth via tonal layering

## 2. Colors

A single warm-cream family carrying both surface and neutral text, with one muted-orange accent that earns its rare appearances.

### Primary
- **Burnt Orange Accent** (#c8552b): the eyebrow chip's color, the logo dot, the italic emphasis inside the hero headline. Decorative; never a surface, never a button background.
- **Accent Deep** (#a8431f): the darker variant for hover and emphasis states; same hue, a step deeper.

### Neutral
- **Cream** (#faf6ef): the page surface, the nav background (translucent), and the bottom of the hero gradient.
- **Cream Warm** (#f4ebdc): the feature card surface; one shade darker than cream, anchors the card group as a contained set.
- **Peach** (#f6dfcb): the warmer stop of the hero gradient. Atmospheric, not structural.
- **Ink** (#1f1a15): primary body text; primary-button background; the dark CTA section's surface.
- **Soft** (#5b4f44): secondary text; captions; footer copy; nav link rest state.
- **Line** (#e6dccb): hairline borders on cards, the nav, the footer, and the icon tiles.

### Named Rules
**The Cream-Family Rule.** Every neutral surface tints toward the brand hue. No pure white anywhere, no pure black, no untinted gray. The eye should never read this page as "default browser."

**The 10% Accent Rule.** The burnt orange covers no more than 10% of any rendered surface. Its rarity is the point.

## 3. Typography

**Display Font:** Fraunces (Georgia fallback, serif)
**Body Font:** Inter (system-ui fallback, sans-serif)

**Character:** A magazine-cover serif for the headlines and brand mark, paired with a refined sans for everything else. The italic Fraunces inside `<em>` is the system's only italic, used exactly once per page on a single word inside the hero headline.

### Hierarchy
- **Display** (Fraunces, clamp(48px, 7vw, 88px), weight 400, line-height 1.05, letter-spacing -0.02em): hero headlines only.
- **Headline** (Fraunces, clamp(36px, 4.5vw, 52px), weight 400, line-height 1.1): section headlines.
- **Title** (Fraunces, 22px, weight 500, letter-spacing -0.01em): card headings.
- **Lede** (Inter, 20px, weight 400, line-height 1.55): the supporting paragraph below a hero headline.
- **Body** (Inter, 15–18px, weight 400, line-height 1.55): default paragraph copy. Cap line length at 65–75ch.
- **Label** (Inter, 12px, weight 600, letter-spacing 0.16em, uppercase): the eyebrow chip and any small uppercase labels.

### Named Rules
**The One-Italic Rule.** Italic appears exactly once per page: on a single emphasized word inside the hero headline. Nowhere else. The logo strip's italic Fraunces wordmarks are the exception that proves it (wordmark, not running italic).

**The No-Gradient-Text Rule.** Type is solid color, always. The hero's cream-to-peach gradient is a section background, never a typographic effect.

## 4. Elevation

Flat. No shadows on cards, buttons, surfaces, or any rendered element. Depth is conveyed by three things and only those:

- **Tonal layering**: cream (page) sits below cream-warm (cards), which sit below ink (the dark CTA section).
- **Hairline borders**: 1px line color (`--line`) on every contained surface.
- **Sticky-nav backdrop blur**: the only blur in the system, marking the nav as living above content.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. Hover lift uses `transform: translateY(-1px)`, never a shadow. Glassmorphism, neon glow, and elevation halos are absent by design.

## 5. Components

### Buttons
- **Shape:** fully rounded (border-radius: 999px). The full-size variant is 14px 28px padding; the smaller nav pill is 9px 18px.
- **Primary** (`.btn-primary`, `.pill`): background ink, text cream. The primary CTA on every section.
- **Ghost** (`.btn-ghost`): transparent background, ink 1px border, ink text. Secondary CTA, always paired with primary.
- **Hover:** translateY(-1px), 150ms ease.
- **Inverted Primary** (`.cta-section .btn-primary`): background cream, text ink. Used because the dark CTA section reverses the surface contrast.

### Cards (Feature Tiles)
- **Corner Style:** 20px rounded (less than pill, more than container).
- **Background:** cream-warm (`--cream-warm`), one shade darker than the surrounding cream surface.
- **Border:** 1px line color.
- **Internal Padding:** 40px 32px (generous; cards breathe).
- **Shadow:** none, see Elevation.

### Icon Tile (inside Cards)
- **Size:** 56×56px.
- **Background:** cream (`--cream`).
- **Border:** 1px line color.
- **Corner Style:** 14px rounded.
- **Position:** centered above the card heading, 24px bottom margin.

### Eyebrow Chip
- **Style:** uppercase Inter, 12px, weight 600, letter-spacing 0.16em, color accent-deep (#a8431f). No background or border — pure typographic label.
- **Position:** standalone above the hero `<h1>`, with 32px bottom margin.

### Navigation
- **Background:** translucent cream (`rgba(250, 246, 239, 0.85)`) with `backdrop-filter: blur(10px)`. Sticky to the top.
- **Border:** 1px line color at the bottom edge.
- **Links:** 14px Inter, weight 400, color soft (rest), color ink (hover). The trailing pill CTA uses the nav-pill component.

### Logo Strip
- **Items:** Fraunces italic, 22px, color soft. Six wordmarks, justified across a single row, separated by hairline borders top and bottom.

## 6. Do's and Don'ts

### Do:
- **Do** keep the burnt-orange accent under 10% of any visible surface; it's a typographic accent and a logo dot, not a button.
- **Do** use Fraunces for display and Inter for body; respect the One-Italic Rule.
- **Do** carry depth via tonal layering and hairline borders, not shadows.
- **Do** tint every neutral toward the cream hue. Reject pure white and pure gray.
- **Do** keep buttons fully rounded (999px) and cards moderately rounded (20px); the contrast is intentional.

### Don't:
- **Don't** add box-shadows to surfaces. The system is flat by default; hover lift uses transform, not shadow.
- **Don't** introduce gradient text or `background-clip: text`. The hero gradient is a section background, never a typographic effect.
- **Don't** add glassmorphism, neon glow, dark mode by default, or side-stripe colored borders — all banned in PRODUCT.md anti-references.
- **Don't** introduce a fourth color outside the cream / ink / orange family without an explicit reason recorded in PRODUCT.md.
- **Don't** drift into the broader "Fraunces-cream-peach SaaS template" the page already exemplifies. The PRODUCT.md anti-references this aesthetic; departure-mode variants should diffuse away from it.
