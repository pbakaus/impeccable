---
name: Impeccable
description: Paper and instruments. Neutral paper and ink, gold as jewelry, patina where color must read.
colors:
  kinpaku: "oklch(84% 0.19 80.46)"
  kinpaku-vivid: "oklch(87% 0.20 85)"
  kinpaku-rich: "oklch(77% 0.13 82)"
  kinpaku-deep: "oklch(61% 0.085 78)"
  on-gold: "oklch(14% 0.018 95)"
  patina: "oklch(70% 0.12 188)"
  patina-pale: "oklch(82% 0.07 188)"
  patina-deep: "oklch(46% 0.08 188)"
  patina-ink: "oklch(38% 0.08 188)"
  vermilion: "oklch(52% 0.16 35)"
  paper: "oklch(97.8% 0 0)"
  paper-raised: "oklch(99.5% 0 0)"
  paper-deep: "oklch(95% 0 0)"
  gray: "oklch(92% 0 0)"
  gray-2: "oklch(88% 0 0)"
  ink: "oklch(13% 0 0)"
  text: "oklch(22% 0 0)"
  text-muted: "oklch(46% 0 0)"
  text-faint: "oklch(56% 0 0)"
  text-mute-deep: "oklch(66% 0 0)"
  rule: "oklch(13% 0 0 / 0.08)"
  edge: "oklch(13% 0 0 / 0.45)"
typography:
  scale:
    "9": "0.5625rem"
    "10": "0.625rem"
    "11": "0.6875rem"
    "12": "0.75rem"
    "13": "0.8125rem"
    "14": "0.875rem"
    "15": "0.9375rem"
    "16": "1rem"
    "17": "1.0625rem"
    "20": "1.25rem"
    "22": "1.375rem"
    "24": "1.5rem"
    "25.6": "1.6rem"
    "36": "2.25rem"
    "40": "2.5rem"
    "48": "3rem"
    "52": "3.25rem"
    "104": "6.5rem"
  display:
    fontFamily: '"Alumni Sans", var(--ks-font-wordmark)'
    fontWeight: 200
    lineHeight: 1.2
  wordmark:
    fontFamily: '"Avenir Next Condensed", "Roboto Condensed", "Arial Narrow", var(--ks-font)'
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.16em"
  title:
    fontFamily: '"Avenir Next", "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif'
    fontSize: "13px"
    fontWeight: 600
  body:
    fontFamily: '"Avenir Next", "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif'
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  bundled:
    fontFamily: '"Albert Sans", var(--ks-font)'
    fontWeight: 400
  label:
    fontFamily: 'ui-monospace, "SF Mono", SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace'
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.12em"
  tag:
    fontFamily: 'ui-monospace, "SF Mono", SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace'
    fontSize: "9px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.06em"
rounded:
  xs: "2px"
  sm: "3px"
  md: "8px"
  button: "10px"
  panel: "12px"
  card: "14px"
  sheet: "16px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "20px"
components:
  button-primary:
    backgroundColor: "{colors.kinpaku}"
    textColor: "{colors.on-gold}"
    rounded: "{rounded.button}"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.kinpaku-vivid}"
  button-secondary:
    backgroundColor: "{colors.paper-deep}"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    height: "40px"
  button-secondary-hover:
    backgroundColor: "{colors.gray}"
  tag:
    backgroundColor: "{colors.kinpaku}"
    textColor: "{colors.on-gold}"
    typography: "{typography.tag}"
    rounded: "{rounded.sm}"
    padding: "0 5px"
  tag-quiet:
    backgroundColor: "{colors.gray}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.sm}"
  tool-button-active:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    size: "26px"
---

# Design System: Impeccable

## Overview

**Creative North Star: "Paper and Instruments"**

Surfaces are neutral paper (chroma 0) and type is ink: no warm cast, no dark section backgrounds. Gold is jewelry. A raised or dark surface is something you operate: a recessed track, a raised cap, a lit gold dot. One light theme everywhere, including inside dark DevTools, where the panel is a sheet laid on the tool with a hardened ink seam.

**Key Characteristics:**
- Chroma-0 paper and ink; color appears only as gold jewelry, patina state or vermilion failure.
- Controls are paper hardware with real depth; everything else is flat.
- Dense UI: 11px is the floor for anything functional.

## Colors

### Named Rules
**The Gold Is Jewelry Rule.** Kinpaku fills the mark, a hairline, the lit dot on a control, the tag and the extension's one primary button; it never carries text on paper and never fills a panel. (The vendored site kit's primary button is ink-filled; keep it so.)

**The Gold Text Is a Bug Rule.** Gold at 84% lightness lands under 2:1 on paper. Text that has to be colored is patina-deep, which clears 4.5:1. Text on a gold fill is on-gold.

**The Severity Rule.** AI tell is the gold tag and a lit gold dot, quality is a patina dot with patina-deep text, failure is vermilion. In the detector surfaces (popup, DevTools panel and sidebar) vermilion marks only a scan that did not run; the walks panel also uses it for a risky step and a failed walk.

## Typography

Extension pages cannot load web fonts, so the shared surface matches the site faces from system stacks: Avenir Next for everything read, Avenir Next Condensed for the wordmark, ui-monospace for keys, selectors, counts and the tag. The popup and the walks panel bundle Alumni Sans and Albert Sans in the extension package; Alumni Sans at weight 200 sets the big words, such as the popup's count.

**The Mono Means Machine Rule.** Selectors, counts, section labels and tags are mono, as in the agent. Labels are uppercase and tracked (0.12em).

## Elevation & Depth

Flat by default. Depth exists only on instruments.

- **--ks-cap-lift:** `inset 0 1px 0 oklch(100% 0 0 / 0.9), 0 1px 0 oklch(13% 0 0 / 0.14), 0 2px 3px oklch(13% 0 0 / 0.08)`: the raised cap on an instrument control, a hovered or held tool button, the switch knob.
- **--ks-cap-press:** `inset 0 1px 2px oklch(13% 0 0 / 0.14)`: a cap while pressed.
- **--ks-track-recess:** `inset 0 1px 3px oklch(13% 0 0 / 0.16), inset 0 -1px 0 oklch(100% 0 0 / 0.7)`: the sunk track under segmented caps and the switch.
- **--ks-lift-1:** `0 1px 1px oklch(13% 0 0 / 0.05), 0 2px 3px oklch(13% 0 0 / 0.04), 0 6px 12px oklch(13% 0 0 / 0.05)`: a surface lifted off the paper (a hovered map tile, a kit panel); a control takes the cap instead.
- **--ks-led:** `0 0 0 1px oklch(13% 0 0 / 0.12), 0 0 4px oklch(84% 0.19 80 / 0.6)`: a lit gold dot, and only that.

## Shapes

Small and exact on the detector surfaces: 3px on tags, chips, rows and tool caps (2px inside a segmented track); pill on the switch track; 10px on popup and walks-panel buttons. The walks panel's softer cards and sheets take 8, 12, 14 and 16px. Focus is a 2px patina outline at 2px offset.

## Components

- **Segmented control and switch:** gray recessed track, paper-raised cap with cap lift, a gray-2 dot that lights gold with the LED when selected or on.
- **Tool button:** 26px, transparent at rest; hovered or held it becomes a raised cap; held shows a 4px lit dot.
- **Finding row:** ink name, patina-deep mono selector, muted description; paper-deep on hover.
- **Tag:** mono 9px uppercase, ink on gold for an AI tell, gray and muted for quality.
- **Buttons:** primary is gold with on-gold ink, brightening to kinpaku-vivid; secondary is paper-deep, gray on hover.

## Do's and Don'ts

### Do:
- **Do** read every value from the `--ks-*` tokens rather than hand-typing oklch.
- **Do** give every lit indicator the LED glow, and only lit indicators.

### Don't:
- **Don't** set gold text on paper.
- **Don't** add a dark theme or a dark section background; tune the seam instead.
- **Don't** use vermilion for anything but a failure, or a risky step in the walks panel.

## Where it lives

- `extension/shared/kinpaku.css`: the `--ks-*` tokens, doctrine, tag, mark, focus.
- `extension/popup/popup.css`: popup count, buttons, bundled faces.
- `extension/devtools/panel.css`: toolbar, findings, segmented control, switch.
- `extension/devtools/sidebar.css`: findings on the selected element.
- `extension/walks/panel/panel.css`: walks side panel, with its own copied tokens.
- `ui/component-review/vendor/kinpaku-tokens.css`: vendored site tokens; never edit.
- `ui/component-review/vendor/kinpaku-kit.css`: vendored site kit; never edit.
