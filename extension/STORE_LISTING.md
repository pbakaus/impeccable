# Chrome Web Store Listing

Copy for the Developer Dashboard. Every field below maps to one dashboard
field; paste them as they are. Keep this file in step with the manifest
(`extension/manifest.json`) and the rule registry (the count comes from
`extension/detector/antipatterns.json` after `bun run build:extension`).

## Name
Impeccable

## Short description (132 chars max)
Detect AI slop and design anti-patterns in any web page. Open DevTools and see what needs fixing.

## Detailed description

Impeccable detects 61 common UI anti-patterns directly in your browser. Open the Impeccable panel in DevTools on any page and overlays highlight issues, from AI-generated design tells to accessibility and quality problems.

WHAT IT DETECTS

AI slop (design tells that scream "AI made this"):
- Cream and beige "AI default" backgrounds
- Purple/violet AI color palettes
- Gradient text on headings
- Side-tab and rounded-border accent stripes
- Nested cards, monotonous spacing, icon-tile stacks, edge-flush cards
- Bounce and elastic easing, hover image zoom, marquees, pulsing dots, blinking cursors
- Dark mode with glowing accents, radial halos and spotlight glows
- Overused fonts, flat type hierarchy, italic-serif heroes
- Oversized H1s, extreme negative letter-spacing
- Uppercase eyebrow chips, kickers above headings, numbered section markers
- Em-dash overuse, marketing buzzwords, aphoristic cadence, "theater" phrases
- Thin borders with wide drop shadows, repeating-stripe and grid backgrounds
- Shape-assembled illustrations, organic clip paths, buried raster images

Quality issues (general design and accessibility):
- Low contrast text (WCAG AA), gray text on colored backgrounds, occluded text
- Cramped padding, tight line height, uneven heading rhythm
- Skipped heading levels
- Line length too long, text running to the viewport edge, columns overflowing the first viewport
- Tiny body text, undersized UI text, justified text, all-caps body copy, wide letter-spacing
- Layout-property animations, clipped overflow containers, text overflow
- Broken images, script errors, content hidden at rest, repeated container text
- Drift from a project's own design system (fonts, colors, radii, type sizes)

HOW IT WORKS

1. Install the extension
2. Open DevTools on any page (Cmd+Opt+I / F12) and click the "Impeccable" panel tab
3. The page is scanned and overlays highlight every finding
4. The panel lists the findings, grouped as AI tells and quality issues
5. Click any finding to jump to the element in the Elements panel

FEATURES

- Scans when you open the panel; opt in to scanning the moment DevTools opens
- Grouped findings: AI tells vs. quality issues
- Click-to-inspect: jump from a finding to the element
- Toggle overlays on/off from the panel or the toolbar popup
- Per-rule settings: disable detections you don't care about
- Re-scans on navigation, including SPA route changes
- Works on any website, including pages with a strict Content Security Policy
- Runs 100% locally, no data sent anywhere

The same 61 rules power the Impeccable CLI and the live design mode, built from one open-source rule engine.

Open source at https://github.com/pbakaus/impeccable

## What's new (version notes for 1.4.0)

The detector now runs as WebAssembly in an extension offscreen document. The page is snapshotted and the rules evaluate that snapshot, so a site's Content Security Policy no longer decides whether the detector runs. Same rules as the Impeccable CLI and live mode, built from the same source, now 61 of them. New "offscreen" permission for exactly that; nothing about what the extension can see has changed.

## Category
Developer Tools

## Language
English

## Privacy policy URL
https://impeccable.style/privacy

## Single purpose description
Detects and highlights UI anti-patterns (AI-generated design tells and general quality issues) on any web page.

## Permission justifications (Privacy practices tab)

- **activeTab**: Scans the page the user is looking at when they open the panel or press Scan in the popup; nothing runs on tabs the user has not asked about.
- **scripting**: Injects the content script that takes the page snapshot and draws the finding overlays on the current tab.
- **storage**: Saves the user's own settings (disabled rules, overlay visibility, the auto-scan preference) in Chrome sync storage. No page data is stored.
- **webNavigation**: Re-scans after in-page navigation in single-page apps, where no full page load happens.
- **offscreen**: Runs the WebAssembly rule engine over the page snapshot in an offscreen document, because page Content Security Policies block WebAssembly in the content-script and page worlds. The document is created for a scan and closed afterward.
- **Host permission (all sites)**: The user can scan any site they visit; the scan runs only on the active tab when the user asks for it.

## Remote code
No. The rule engine (WebAssembly) and all scripts ship inside the package. Nothing is fetched or evaluated from the network.

## Data usage
The extension collects no user data. Scans run locally; no page content, findings, or identifiers leave the browser. Certify: not being sold to third parties, not used for purposes unrelated to the single purpose, not used for creditworthiness or lending.
