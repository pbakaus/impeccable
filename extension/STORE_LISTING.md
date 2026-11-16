# Chrome Web Store Listing

Copy for the Developer Dashboard. Every field below maps to one dashboard
field; paste them as they are. Keep this file in step with the manifest
(`extension/manifest.json`) and the rule registry (the count comes from
`extension/detector/antipatterns.json` after `bun run build:extension`).

Each section ends with the Chrome Web Store policy it answers to, in our own
words, with its address. Read the policy page itself before changing a section.

## Name
Impeccable

## Short description (132 chars max)
Find design and usability problems on any web page: scan it for AI slop and anti-patterns, or send an AI persona to try a task.

The manifest's `description` is this same sentence.

## Single purpose description
Impeccable finds design and usability problems in the web page you are looking at. It does this in two ways: a scan that flags design anti-patterns on the page, and a journey, where an AI persona tries a task on the page and reports the usability problems it meets. Both report problems with the same page to the same person; neither does anything else.

> Policy: one purpose, "narrow and easy to understand", with no bundle of unrelated features.
> https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines

## Detailed description

Impeccable finds design and usability problems in the web page you are looking at.

SCAN (free, no account)

The scan checks a page against 62 design anti-patterns and outlines every finding on the page. Open the Impeccable panel in DevTools, or click the toolbar icon and press Scan page.

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

How the scan works:
1. Open DevTools on any page (Cmd+Opt+I / F12) and click the "Impeccable" panel tab, or click the toolbar icon and press Scan page
2. The page is scanned and outlines mark every finding
3. The panel lists the findings, grouped as AI tells and quality issues
4. Click any finding to jump to the element in the Elements panel

- Scans when you open the panel; opt in to scanning the moment DevTools opens
- Per-rule settings: disable detections you don't care about
- Re-scans on navigation, including single-page app route changes
- Works on any website, including pages with a strict Content Security Policy
- Scans run on your computer. Nothing about the page leaves your browser.

JOURNEYS (Impeccable Pro, a paid plan)

A journey sends an AI persona to try a task on a page, the way a real visitor would, and tells you where it got stuck. Journeys need Impeccable Pro, a paid plan.

How a journey works:
1. Click the toolbar icon, press Impeccable Pro and sign in to your Impeccable account
2. Open the side panel on the page you want tested, pick a persona and type what it should try
3. Read the plan. Steps that can't be undone are marked. Nothing starts until you press Start journey
4. Watch each step in the side panel, and stop it at any time
5. At the end, open the results: every step, and the problems the persona found

You can also start a journey from the Impeccable web app, which opens one new tab for it. The web app's page hands the journey to the extension, so the extension itself needs no sign-in for it.

What a journey can and can't do:
- It acts only in its one tab, which is put in a tab group named after the persona. It never reads your other tabs.
- It works on the site you started it on. On any other site it can only look: it never clicks or types there.
- It pauses by itself at a sign-in page, so you type your own password. While paused, it does not look at the page.
- Downloads and pop-up tabs the page tries to open are cancelled and closed.
- Chrome shows its "started debugging this browser" bar for as long as a journey is running.

What a journey sends:
- While a journey runs, the journey's tab is sent to Impeccable's servers as screenshots and as a stream of frames (a video of the tab), with the text of its pages, the addresses it visits or was stopped from opening, the text of any dialog it closes, and the address of any download the page tries to start (the download itself is cancelled).
- The persona is run by an AI model provider, today Google (Gemini API), which receives what the persona sees.
- The frames, screenshots and steps are kept so you can replay the journey, for <<TODO: how long journey replays are kept>>.
- While a journey is paused, no screenshots or frames are taken and nothing of the page is sent.
- Until you ask for a journey's plan, nothing about the pages you visit is sent. The plan request carries the tab's address. Otherwise the extension asks Impeccable's server whether sign-in is available, and, once you are signed in, for your account and your personas.
- Talk to type: when you press the mic in the side panel, Chrome's built-in speech recognition turns your voice into text, and to do that Chrome sends the audio to Google's speech service. Impeccable never receives, records or keeps your audio; only the text you choose to send reaches Impeccable.

The same 62 rules power the Impeccable CLI and the live design mode, built from one open-source rule engine.

Open source at https://github.com/pbakaus/impeccable

## What's new (version notes for 1.5.0)

Journeys. Sign in to Impeccable Pro, open the side panel on any page, pick a persona and a task, approve the plan, and watch the persona try it. The scan is unchanged and still runs on your computer with no account. Chrome asks you to accept new permissions for this update (the debugger, tab groups and downloads); each is used only by a journey you start.

## Category
Developer Tools

## Language
English

## Privacy policy URL
https://impeccable.style/privacy

> Policy: an extension that handles user data must post an accurate, current privacy policy that says how data is collected, used and shared, and with whom.
> https://developer.chrome.com/docs/webstore/program-policies/privacy

## Permission justifications (Privacy practices tab)

- **activeTab**: Scans the page the user is looking at when they open the panel or press Scan page in the popup; nothing runs on tabs the user has not asked about.
- **scripting**: Injects the content script that takes the page snapshot and draws the finding outlines on the current tab.
- **storage**: Saves the user's own settings (disabled rules, outline visibility, the auto-scan preference) in Chrome sync storage, and the state of a running journey for the side panel. No scanned page data is stored.
- **webNavigation**: Re-scans after in-page navigation in single-page apps, where no full page load happens.
- **offscreen**: Runs the WebAssembly rule engine over the page snapshot in an offscreen document, because page Content Security Policies block WebAssembly in the content-script and page worlds. The document is created for a scan and closed afterward.
- **identity**: Signs the user in to their Impeccable account when they press Impeccable Pro (`chrome.identity.launchWebAuthFlow`, OAuth 2.1 with PKCE). It is used for nothing else and never reads the user's Google account.
- **sidePanel**: Where a signed-in user picks a persona, types the task, approves the plan and watches the journey, with Stop always in reach. A journey handed over from the web app shows its steps and Stop there too.
- **debugger**: Drives the one tab of a journey: the clicks, typing, screenshots and page reads the persona needs, and holding that tab to the site the user chose. It attaches only to that tab, only after the user starts a journey, and detaches when the journey ends or the user stops it. Chrome shows its debugging bar throughout.
- **tabs**: Reads the journey tab's address so the journey can be stopped the moment it leaves the chosen site, opens the journey's tab and its results, and closes tabs the journey's page tries to open.
- **tabGroups**: Puts the journey's tab in a named group of its own so the user can tell it apart from their own tabs.
- **downloads**: Cancels and removes any download the journey's tab starts; a journey never saves files.
- **Host permission (all sites)**: The user can scan any site they visit, and can choose to have every page scanned as DevTools opens (auto-scan, off by default); a scan runs only in a tab the user has opened Impeccable on. A journey can be started on any site the user chooses. The extension's own content scripts run only on the Impeccable web app's journey, sign-in and welcome pages.

> Policy: ask for the narrowest permissions the features need, and none for features not built yet.
> https://developer.chrome.com/docs/webstore/program-policies/permissions

## Remote code
Answer: **Yes, I am using remote code.**

Justification: The extension's own code, including the rule engine (WebAssembly), ships inside the package, and nothing from the network runs in the extension itself. During a journey the user started, Impeccable's server sends Chrome DevTools Protocol commands through the `chrome.debugger` API to the journey's one tab (click, type, take a screenshot, read the page), and some of those commands evaluate a short script in that tab. That is the only remote logic, it runs only in the journey's tab, and only while Chrome's debugging bar is showing.

> Policy: logic from a remote source may run only through a documented API made for it; the Debugger API is one of the two named.
> https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements

## Data usage

### What the extension handles

- **Scan:** the page snapshot and the findings stay in the browser. The user's settings are kept in Chrome sync storage. Nothing about the page is sent.
- **Until the user asks for a journey's plan:** nothing about the pages the user visits is sent. Opening the popup or the side panel asks Impeccable's server whether sign-in is available; signed in, it also asks for the account and its personas.
- **Sign-in:** the user signs in on Impeccable's own sign-in page, in a window Chrome opens. The extension keeps the sign-in tokens in the browser, sends them only to Impeccable's server, and reads the account's email and name to show who is signed in. It never sees a password.
- **Before a journey:** the persona and the task the user typed, and the address of the tab the journey will run in, go to Impeccable's server to make the plan. A persona the user describes is sent to be created.
- **A journey handed over from the web app:** the web app's journey page hands the journey to the extension, which needs no sign-in of its own for it. It then sends what any journey sends, below.
- **During a journey:** the journey's tab is streamed as frames (a video of the tab) and sent as screenshots, with the text of its pages, the addresses it visits or was stopped from opening, the text of any dialog it closes and the address of any download it tries to start. All of it goes to Impeccable's servers and to the AI model provider that runs the persona, today Google (Gemini API); the privacy policy names every provider. The frames, screenshots and steps are kept with the journey so the user can replay it, for <<TODO: how long journey replays are kept>>.
- **Never:** any other tab, browsing history outside a journey, screenshots, frames or page text while a journey is paused, the contents of downloads. Nothing is sold, and nothing is used for advertising.

### Data types to tick (Privacy practices tab, "Data usage")

Tick the form's box for each of these five. The names are the user data FAQ's; the form may word a box differently, so match by meaning.

- **Personally identifiable information**: the signed-in account's email and name.
- **Authentication information**: the sign-in tokens for the user's Impeccable account, kept in the browser.
- **Website content and resources**: screenshots, a stream of frames and page text of the journey's tab.
- **Web browsing activity**: the addresses the journey's tab visits or was stopped from opening, the address of any download it tries to start, and whether its pages finished loading, during a journey only.
- **User-generated content**: the task and the persona descriptions the user types.

Leave unticked: financial and payment information, health information, personal communications, form data. A journey's screenshots show whatever is on the page the user chose, so the first-run screen tells the user to keep journeys off private sites such as banking or health.

### Certifications

Tick all three: the data is not sold to third parties; it is not used or transferred for purposes unrelated to the single purpose; it is not used or transferred to determine creditworthiness or for lending.

> Policy: user data may be collected, used and sent only as the disclosed single purpose needs, never sold or used for advertising, and the handling must be disclosed in the product itself, not only in a policy.
> https://developer.chrome.com/docs/webstore/program-policies/limited-use
> https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements
> https://developer.chrome.com/docs/webstore/program-policies/user-data-faq

## Test instructions (Test instructions tab)

Journeys need an Impeccable Pro account. Put the test account's sign-in in the dashboard's own username and password fields, never in this file.

```
The scan needs no account. Journeys need the test account in the fields above.

SCAN
1. Open https://example.com.
2. Click the Impeccable toolbar icon and press "Scan page". The popup shows a count and the page shows outlines.
3. Or open DevTools and click the "Impeccable" panel tab: the same findings, listed.

SIGN IN
4. Click the toolbar icon and press "Impeccable Pro" at the foot of the popup.
5. Chrome opens Impeccable's sign-in window. Sign in with the test account <<TODO: test account email>> and the password in the fields above.
6. A welcome page opens. Press its button to open the side panel. From now on the toolbar icon opens the side panel.

JOURNEY
7. Open the page to test in a normal tab, for example <<TODO: public test page address>>, and click the toolbar icon.
8. The first time, the side panel shows two short screens: press "Got it", then "Start a journey".
9. Pick a persona, type a task such as "Find the pricing page", and press Send.
10. A short plan appears. Press "Start journey".
11. Chrome shows "Impeccable started debugging this browser". The tab moves into a tab group named after the persona, and the side panel lists each step.
12. Press Stop at any time to end the journey.
13. At the end, press the button in the side panel to open the journey's results.

SIGN OUT
14. Right-click the toolbar icon, choose Options, and press "Sign out".

A journey acts only in its own tab and only on the site it was started on.
```
