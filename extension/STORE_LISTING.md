# Chrome Web Store Listing

Copy for the Developer Dashboard. Every field below maps to one dashboard
field; paste them as they are. Keep this file in step with the manifest
(`extension/manifest.json`) and the rule registry (the count comes from
`extension/detector/antipatterns.json` after `bun run build:extension`).

> Draft: the lines about journeys (permissions, remote code, data usage) are not
> final. The repository owner reviews store copy before any of it is pasted.

This listing describes the store build (`dist/extension.zip`, staged by
`bun run build:extension`). The unpacked development build (the `extension/`
folder as committed) does more, and none of it ships to the store: it signs in
to an Impeccable account (`identity`, `alarms`, `notifications`), starts
journeys on the person's own tab from the side panel, checks in with the server
every 30 seconds while signed in with Impeccable Pro, sends the side panel's
current page address (query included), task and persona text to the server, offers talk to type through
Chrome's speech recognition, and takes journeys from staging and this machine.

## Name
Impeccable

## Short description (132 chars max)
Detect AI slop and design anti-patterns in any web page. Open DevTools and see what needs fixing.

## Detailed description

Impeccable detects 62 common UI anti-patterns directly in your browser. Open the Impeccable panel in DevTools on any page and overlays highlight issues, from AI-generated design tells to accessibility and quality problems.

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
- Toggle overlays on/off from the DevTools panel or the side panel
- Per-rule settings: disable detections you don't care about
- Re-scans on navigation, including SPA route changes
- Works on any website, including pages with a strict Content Security Policy
- Scans run 100% locally, no data sent anywhere

JOURNEYS

Journeys are started from the Impeccable web app. The person picks a persona and what it should do; the extension opens one new tab in a tab group of its own and lets Impeccable's server drive that tab, step by step, while the person watches. A side panel shows each step, and the person can pause, take over or stop at any time. A journey acts only on the one tab it opened, and only on the site the person chose.

The same 62 rules power the Impeccable CLI and the live design mode, built from one open-source rule engine.

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
Check and test your site's design: find design problems on any page, and watch personas try your site.

## Permission justifications (Privacy practices tab)

- **activeTab**: Scans the page the user is looking at when they open the panel or press Scan in the popup; nothing runs on tabs the user has not asked about.
- **scripting**: Injects the content script that takes the page snapshot and draws the finding overlays on the current tab.
- **storage**: Saves the user's own settings (disabled rules, overlay visibility, the auto-scan preference) in Chrome sync storage. No page data is stored.
- **webNavigation**: Re-scans after in-page navigation in single-page apps, where no full page load happens.
- **offscreen**: Runs the WebAssembly rule engine over the page snapshot in an offscreen document, because page Content Security Policies block WebAssembly in the content-script and page worlds. The document is created for a scan and closed afterward.
- **Host permission (all sites)**: The user can scan any site they visit; the scan runs only on the active tab when the user asks for it. Journey content scripts run only on the Impeccable web app's journey and sign-in pages.
- **debugger**: Drives the one tab a journey opens: clicks, typing, screenshots and page reads that the server asks for, and holding that tab to the site the person chose. It attaches only to that tab, only after the person starts a journey from the Impeccable web app, and detaches when the journey ends or the person stops it.
- **tabs**: Opens the journey's tab, closes tabs its page tries to open, and reads that tab's address so it can be stopped the moment it leaves the chosen site.
- **tabGroups**: Puts the journey's tab in a named group of its own so the person can tell it apart from their own tabs.
- **sidePanel**: Shows the journey as it happens, with Pause, Take over and Stop.
- **downloads**: Cancels and removes any download the journey's tab starts; a journey never saves files.
- **declarativeNetRequestWithHostAccess**: While a journey runs and has not been allowed to change anything, blocks requests that would change something (form posts and other writes) that the journey's own page cannot be held from: a tab it opens, a frame from another site inside it, and its site's background workers. The rules are removed as soon as writes are allowed, the person takes over, or the journey ends.

## Remote code
The extension's own code, including the rule engine (WebAssembly), ships inside the package. A journey runs only the extension's own page helpers (`walks/page-helpers.js`, generated, readable source): the server names one and gives its data, to read and act on the journey's tab, never typing into or reading a field the page marks as a password, card or one-time code (by its `type` or `autocomplete`), and taking screenshots with those fields blacked out (checked as drawn before each screenshot, which is not taken otherwise). A field that may hold a password (one named for a password, or a text field a "show password" button put in its place) is blacked out and never read too. A card or code field the page does not mark is not known as one. A journey marks each password field it sees on the journey's tab (`data-impeccable-secret-field`), each field that may hold one (`data-impeccable-secret-maybe`), and the forms round them (`data-impeccable-secret-form`, `data-impeccable-secret-form-name`), so one the person shows as text stays covered in screenshots; the marks stay with that page. Cookie banners are declined with DuckDuckGo's autoconsent rules (MPL-2.0), bundled in `walks/consent-rules.js`. Until every server names helpers, an older server may still send short page scripts that run in the journey's tab only, and such a journey pauses while a password field or a field that may hold one is filled (for the latter, until the person presses Continue); nothing from the network runs in the extension itself.

## Data usage
Scans run locally; no page content, findings, or identifiers leave the browser. During a journey the person started, what the server asks for of the journey's tab (screenshots, page content and its address) is sent to Impeccable's server to run the journey and show its results to that person; nothing from any other tab is read or sent. When a journey pauses itself at a sign-in page, it takes one screenshot of that page with every field drawn blank and sends it with the page's title, if the server asks for it. Nothing else of the journey's tab is taken or sent while it is paused. Outside a journey the extension sends nothing to any server. Certify: not being sold to third parties, not used for purposes unrelated to the single purpose, not used for creditworthiness or lending.
