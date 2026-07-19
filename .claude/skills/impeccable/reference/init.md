# Init Flow

The setup command for a project. One codebase crawl feeds everything it writes:

- **PRODUCT.md** (strategic): root project file for register, target users, product purpose, brand personality, anti-references, strategic design principles. Answers "who/what/why".
- **DESIGN.md** (visual): root project file for visual theme, color palette, typography, components, layout. Follows the [DESIGN.md format spec](https://raw.githubusercontent.com/google-labs-code/design.md/main/docs/spec.md). Answers "how it looks".
- **`.impeccable/live/config.json`** (live mode): pre-configured so `/impeccable live` boots straight into variant mode with no first-time detour.

It closes by pointing the user at the best command to run next. Every other impeccable command reads PRODUCT.md and DESIGN.md before doing any work.

## Step 1: Load current state

Check what already exists. PRODUCT.md and DESIGN.md live at the project root, or under `.agents/context/` or `docs/` (case-insensitive). Read whichever are present with your native file tool. Also note whether `.impeccable/live/config.json` already exists (Step 6 leaves it untouched if so).

Decision tree:
- **Neither file exists (empty project or no context yet)**: do Steps 2-4 (write PRODUCT.md), then decide on DESIGN.md based on whether there's code to analyze.
- **PRODUCT.md exists, DESIGN.md missing**: skip to Step 5 and offer to run `/impeccable document` for DESIGN.md.
- **PRODUCT.md exists but has no `## Register` section (legacy)**: add it. Infer a hypothesis from the codebase (see Step 2), confirm with the user, write the field.
- **PRODUCT.md exists but has no `## Platform` section (legacy)**: add it the same way, but only when the project is native (`ios` / `android` / `adaptive`) or the user wants it explicit; a missing field already means `web`.
- **Both exist**: STOP and call the AskUserQuestion tool to clarify. Ask which file to refresh. Skip the one the user doesn't want changed.
- **Just DESIGN.md exists (unusual)**: do Steps 2-4 to produce PRODUCT.md.

Never silently overwrite an existing file. Always confirm first.

If init was invoked as a setup blocker by another command, such as `/impeccable craft landing page`, pause that command here. Complete init, then resume the original command. Your own writes are the freshest source; no reload needed. For craft, resume into shape next; init creates project context, but it is not a substitute for the task-specific shape interview and confirmed design brief.

## Step 2: Explore the codebase

Before asking questions, thoroughly scan the project to discover what you can. This single crawl feeds PRODUCT.md, DESIGN.md, **and** the live-mode framework detection in Step 6, so be thorough once rather than re-scanning later:

- **README and docs**: Project purpose, target audience, any stated goals
- **Package.json / config files**: Tech stack, dependencies, existing design libraries, **and the framework** (Vite/SPA, Next.js, Nuxt, SvelteKit, Astro, multi-page static) plus the HTML entry the browser actually loads
- **Existing components**: Current design patterns, spacing, typography in use
- **Brand assets**: Logos, favicons, color values already defined
- **Design tokens / CSS variables**: Existing color palettes, font stacks, spacing scales
- **Any style guides or brand documentation**

Also form a **register hypothesis** from what you find:

- Brand signals: `/`, `/about`, `/pricing`, `/blog/*`, `/docs/*`, hero sections, big typography, scroll-driven sections, landing-page-shaped content.
- Product signals: `/app/*`, `/dashboard`, `/settings`, `/(auth)`, forms, data tables, side/top nav, app-shell components.

Register is a hypothesis at this point, not a decision; Step 3 confirms it.

Also form a **platform hypothesis**:

- Native signals: React Native / Expo (`react-native`, `expo`), Flutter (`pubspec.yaml`, `flutter`), SwiftUI / UIKit (`.swift`, `.xcodeproj`, an `ios/` app target), Jetpack Compose / Android (`build.gradle`, an `android/` app module, `AndroidManifest.xml`). An `ios/` and/or `android/` directory that is a real app target, not just a Capacitor/Cordova wrapper around a website.
- Web signals (the default): a web framework (Vite, Next, Nuxt, SvelteKit, Astro), an HTML entry, a CSS/Tailwind setup, no native app target.

Values: `web` / `ios` / `android` / `adaptive` (one codebase, ships both, adapts per OS). Mobile web is still `web`. Like register, this is a hypothesis; Step 3 confirms it.

Note what you've learned and what remains unclear. Also note any rough edges worth a follow-up command (thin hierarchy, flat or gray palette, missing error/empty states, dull copy); Step 7 turns these into concrete recommendations without re-analyzing.

## Step 3: Ask strategic questions (for PRODUCT.md)

STOP and call the AskUserQuestion tool to clarify. Ask about anything the codebase doesn't answer with strong, explicit evidence.

### Interview mode, not confirmation mode

If the repo is empty or the user's brief is sparse, run a short interview before proposing PRODUCT.md. Do **not** turn a one-sentence request into a complete inferred PRODUCT.md and ask for blanket confirmation.

- Use the harness's structured question tool when one exists. Otherwise, ask directly in chat and stop: one question at a time, with lettered options where the crawl suggests likely answers, waiting for each answer before the next.
- Keep skill vocabulary (register, belief ladder, anti-references) out of question text; ask for the thing in words the user would use. For the brand register, ask like a magazine editor profiling the brand: curious and narrative, drawing out the story, the feel, and what a visitor should come to believe.
- Ask in focused rounds and wait for answers between them. Keep **one topic per question**; add rounds rather than fold several topics into one either-or choice. Options obey the same rule: an option answers only the question asked; never write a compound option that bundles a feeling with a business outcome or names an additional audience.
- Use inferred answers as hypotheses or options, not as finished facts.
- Complete at least one real user-answer round before drafting PRODUCT.md, unless every required answer is directly discoverable from repo docs.
- Round 1 should establish register, platform, users, purpose, positioning, and desired outcome.
- Round 2 should establish brand personality or references, anti-references, and accessibility needs, plus conversion & proof for the brand register.

### Minimum viable interview

Ask enough to complete PRODUCT.md. At minimum, cover register confirmation, **platform confirmation** (`web` / `ios` / `android` / `adaptive`), users, purpose, positioning, brand personality, anti-references, and accessibility needs (plus conversion & proof for the brand register) unless each answer is directly discoverable from repo context. Never let the template's default `web` stand unconfirmed for a native or cross-platform repo. After at least one interview round, you may propose inferred answers, but the user must confirm them before you write PRODUCT.md. Never synthesize PRODUCT.md from the original task prompt alone.

### Register (ask first; it shapes everything below)

Every design task is either **brand** (marketing, landing, campaign, long-form content, portfolio: design IS the product) or **product** (app UI, admin, dashboards, tools: design SERVES the product).

If Step 2 produced a clear hypothesis, lead with it: *"From the codebase, this looks like a [brand / product] surface. Does that match your intent, or should we treat it differently?"*

If the signal is genuinely split (e.g. a product with a big marketing landing), STOP and call the AskUserQuestion tool to clarify. Ask which register describes the **primary** surface. The register can be overridden per task later, but PRODUCT.md carries one default. Settle the default before drafting any register-dependent questions; never batch brand-only questions (Conversion & proof) into the same round as the question that decides the register.

### Platform (ask right after register)

Every project targets **web** (includes responsive mobile web), **ios**, **android**, or **adaptive** (one codebase, ships both, adapts per OS: Flutter, React Native, KMP). Platform picks the native rulebook: HIG for `ios`, Material 3 for `android`, both for `adaptive`, none for `web`.

If Step 2 produced a clear hypothesis, lead with it: *"From the codebase, this looks like a [web / ios / android / adaptive] project. Does that match?"* For cross-platform apps, decide by the **design language the app renders**, not the toolchain: one look on both platforms (Flutter's Material-everywhere default) takes that platform's value; genuine per-OS adaptation (Cupertino on iOS, Material on Android) is `adaptive`. When in doubt, `web`.

A monorepo shipping both a website and a native app gets a PRODUCT.md per app, each with its own `## Platform`; the root PRODUCT.md carries the primary surface's platform.

### Users & Purpose
- Who uses this? What's their context when using it?
- What job are they trying to get done?
- What is this for? A purpose stated in README or docs is a hypothesis, not strong evidence; confirm it, don't transcribe it.
- What does success look like?
- If more than one kind of user is plausible, confirm a primary and secondary audience; don't manufacture a split that isn't there. An audience implied by another answer (a success metric, a CTA) is still unconfirmed; ask before writing it as secondary.
- If the surface speaks to a different audience than the people who use the product, ask the user to name both.
- For brand: what emotions should the interface evoke? (confidence, delight, calm, urgency) Ask this standalone; don't fold emotions into the success question.
- For product: what workflow are they in? What's the primary task on any given screen?

### Positioning
- In one line, what does this do that nothing else does? The single strategic claim every screen reinforces.

### Brand & Personality
- How would you describe the brand personality in 3 words?
- Reference sites or apps that capture the right feel? What specifically about them?
  - Push for specific named references with the *specific* thing about them that fits this brand, not generic "modern" adjectives or category-bucket lanes.
- What should this explicitly NOT look like? Any anti-references?

### Conversion & proof (brand register only)
- What's the primary CTA?
- What's the secondary fallback, for visitors not ready for the primary?
- The one line a visitor should remember after 10 seconds.
- What must the visitor believe, in order, before taking the primary CTA? (The template's belief ladder.)
- What proof is on hand? Ask the user to hand over any testimonials, case studies, press, or client/partner logos they already have. If you can receive files directly, collect them; otherwise create `.impeccable/assets/proof/` and ask the user to add files there. Reference supplied files by path; record text proof inline.

### Accessibility & Inclusion
- Specific accessibility requirements? (WCAG level, known user needs)
- Considerations for reduced motion, color blindness, or other accommodations?

Skip questions where the answer is already clear. **Do NOT ask about colors, fonts, radii, or visual styling here.** Those belong in DESIGN.md, not PRODUCT.md.

## Step 4: Write PRODUCT.md

Write PRODUCT.md only after the user has confirmed the strategic answers from Step 3. If an inferred answer is uncertain or unconfirmed, ask before writing. Confirmed means what the user actually said yes to; do not pad a confirmed answer with extras they never picked (additional anti-references, audiences, roadmap claims, a WCAG level), whether drawn from the crawl, another answer, or your own option text. If an extra belongs in the doc, ask about it first.

Synthesize into a strategic document:

```markdown
# Product

## Register

product

## Platform

web

## Users
[Who they are, their context, the job to be done. Primary audience; a secondary audience or a surface-vs-user split only when they apply.]

## Product Purpose
[What this product does, why it exists, what success looks like]

## Positioning
[The single strategic claim every screen reinforces. Not a visual rule, not an anti-reference.]

## Conversion & proof
[Brand register only. Product register: omit this section entirely, heading included.]
- Primary and secondary CTA: [...]
- The line a visitor remembers after 10 seconds: [...]
- Belief ladder: [...]
- Proof on hand: [testimonials, case studies, press, or logos, referenced by path]

## Brand Personality
[Voice, tone, 3-word personality, emotional goals]

## Anti-references
[What this should NOT look like. Specific bad-example sites or patterns to avoid.]

## Design Principles
[3-5 strategic principles derived from the conversation. Principles like "practice what you preach", "show, don't tell", "expert confidence". NOT visual rules like "use OKLCH" or "magenta accent".]

## Accessibility & Inclusion
[WCAG level, known user needs, considerations]
```

Register is either `brand` or `product` as a bare value. No prose, no commentary. Platform is `web`, `ios`, `android`, or `adaptive`, also a bare value; omit the section only on legacy files you're leaving untouched, otherwise write `web` explicitly.

Write fields as prose, and use bold sparingly: only where a word carries a decision, never as a label lead-in on every line.

Write to `PROJECT_ROOT/PRODUCT.md`. If `.impeccable.md` existed, the loader already renamed it; merge into that content rather than starting from scratch.

## Step 5: Decide on DESIGN.md

Offer `/impeccable document` either way. Two paths:

- **Code exists** (CSS tokens, components, a running site): "I can generate a DESIGN.md that captures your visual system (colors, typography, components) so variants stay on-brand. Want to do that now?"
- **Pre-implementation** (empty project): "I can seed a starter DESIGN.md from five quick questions about color strategy, type direction, motion energy, and references. You can re-run once there's code, to capture the real tokens. Want to do that now?"

If the user agrees, delegate to `/impeccable document` (it auto-detects scan vs seed). Load its reference and follow that flow.

If the user prefers to skip, mention they can run `/impeccable document` any time later.

## Step 6: Configure live mode (when code exists)

**Skip this step when the platform is native** (`ios` / `android` / `adaptive`): live mode drives a browser overlay. A hybrid wrapper or Expo web target serving HTML doesn't change that.

If the project has code with HTML entries and a dev server (the same "code exists" condition that puts `/impeccable document` in scan mode), pre-configure live mode now. You already identified the framework and the served HTML entry in Step 2, so this is nearly free, and it spares the user the first-time setup detour when they later run `/impeccable live`.

**Skip this step for empty / pre-implementation projects** (nothing to inject into yet). Tell the user live mode will configure itself the first time they run it once there's code.

**If `.impeccable/live/config.json` already exists, leave it untouched** and note that live mode is already configured.

Otherwise:

1. Write `.impeccable/live/config.json`. Choose `files` (the HTML entries the browser actually loads), `insertBefore`, and `commentSyntax` from the framework table in [live.md](live.md)'s **First-time setup** section, using the framework you found in Step 2. That table is canonical; do not restate it here. For multi-page static sites, prefer a glob (`["public/**/*.html"]`) over a literal list.
2. Run `node .claude/skills/impeccable/scripts/detect-csp.mjs`. If it reports a patchable shape (`append-arrays` / `append-string`), use the **consent prompt template** from live.md before editing any source file. On decline, skip the patch. For `middleware` / `meta-tag` shapes, surface the detected files and ask the user to add `http://localhost:8400` to `script-src` and `connect-src` manually. For `null`, there's nothing to do.
3. Set `cspChecked: true` in the config once CSP is handled (patched, declined, manual, or not needed). The schema and per-shape patch details live in live.md's First-time setup; follow it rather than duplicating.

Writing the config file is harmless and needs no consent; only the CSP **source-file patch** requires a yes.

## Step 7: Recommend starting points, then wrap up

Summarize tersely:
- Register captured (brand / product) and platform captured (web / ios / android / adaptive)
- What was written (PRODUCT.md, DESIGN.md, live config, or a subset)
- The 3-5 strategic principles from PRODUCT.md that will guide future work
- If DESIGN.md or live config is pending, one line on how to set it up later

Then recommend the **best commands to run next**, drawn from what your Step 2 crawl already surfaced. Do not run a fresh analysis here; surface observations you already have. Tailor to register **and platform**, offer the 2-4 most relevant (not a menu dump), and give the exact command to type. Group by intent:

- **Build something new**: `/impeccable craft <feature>` (shape, then build end-to-end) or `/impeccable shape <feature>` (plan first). Lead with this for empty or early-stage projects.
- **Improve what's there**: name the specific surface. `/impeccable critique <page>` for a scored UX review; `/impeccable audit <area>` for a11y / perf / responsive checks; `/impeccable polish <component>` for a pre-ship pass. When the crawl flagged a specific weakness, point the matching command at it: thin hierarchy or spacing → `layout`, flat or gray palette → `colorize`, missing error / empty states → `harden` or `onboard`, dull or unclear copy → `clarify`.
- **Iterate visually** (web only): `/impeccable live` (configured in Step 6) to pick elements in the browser and generate variants in place. **Skip this group for native platforms.**

The full command menu is one bare `/impeccable` away; keep this list short and pointed.

If init was invoked as a blocker by another impeccable command (e.g. the user ran `/impeccable polish` with no PRODUCT.md), resume that original task now. Your own writes are the freshest source; no reload needed.

Optionally STOP and call the AskUserQuestion tool to clarify. Ask whether they'd like a brief summary of PRODUCT.md appended to CLAUDE.md for easier agent reference. If yes, append a short **Design Context** pointer section there.
