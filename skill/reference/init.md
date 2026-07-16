# Init Flow

The setup command for a project. One codebase crawl feeds everything it writes:

- **PRODUCT.md** (strategic): root project file for target users, product purpose, positioning, audience world, cultural context, non-negotiable direction, personality, anti-references, and strategic design principles. Answers "who/what/why" and preserves the human knowledge future design work must not invent cold. Visitor mode is task-scoped and does not live here.
- **DESIGN.md** (visual): root project file for the user-approved visual world: theme, color roles, typography direction, material and component language, layout behavior, motion, and signature. Follows the [DESIGN.md format spec](https://raw.githubusercontent.com/google-labs-code/design.md/main/docs/spec.md). Answers "how it looks".
- **`.impeccable/live/config.json`** (live mode): pre-configured so `{{command_prefix}}impeccable live` boots straight into variant mode with no first-time detour.

It closes by pointing the user at the best command to run next. Every other impeccable command reads PRODUCT.md and DESIGN.md before doing any work. Identity invention happens here, with the user, not later inside a page build.

## Step 1: Load current state

Check what already exists. PRODUCT.md and DESIGN.md live at the project root, or under `.agents/context/` or `docs/` (case-insensitive). Read whichever are present with your native file tool and remember each resolved path. Refresh the resolved existing file; do not create a second root authority beside it. In a child app that inherits root context, confirm whether the user intends to update the shared root or create app-specific context before writing. Also note whether `.impeccable/live/config.json` already exists (Step 6 leaves it untouched if so).

Decision tree:
- **Neither file exists (empty project or no context yet)**: do Steps 2-5. Write PRODUCT.md, then establish the visual world in DESIGN.md before any build resumes.
- **PRODUCT.md exists, DESIGN.md missing**: do Step 5. For refinement or extension, document a coherent incumbent implementation; otherwise run the visual-world workshop and write a seed DESIGN.md.
- **PRODUCT.md exists but has no `## Platform` section (legacy)**: add it the same way, but only when the project is native (`ios` / `android` / `adaptive`) or the user wants it explicit; a missing field already means `web`.
- **PRODUCT.md is missing Positioning, Audience World, Cultural Context where relevant, or Pinned Direction (legacy)**: interview only for the missing durable fields and merge them into the resolved file before substantial new work.
- **Both exist, ordinary init**: {{ask_instruction}} Ask which file to refresh. Skip the one the user doesn't want changed.
- **Redesign or rebrand**: keep confirmed product facts unless the user changes them, but replace DESIGN.md through a new visual-world choice. The old code and DESIGN.md are evidence and anti-reference, not constraints on the replacement. “Redesign this page/site” is enough authorization; do not require the user to say “discard the identity” twice.
- **Just DESIGN.md exists (unusual)**: do Steps 2-4 to produce PRODUCT.md.

Never silently overwrite an existing file. Always confirm first.

If init was invoked as a setup blocker by another command, such as `{{command_prefix}}impeccable craft landing page`, pause that command here. Complete init, then resume the original command. Your own writes are the freshest source; do not rerun `context.mjs`. For craft, resume into the task-specific discovery and [new-work.md](new-work.md); init commits the world, while the surface flow decides the requested composition inside it.

## Step 2: Explore the codebase

Before asking questions, thoroughly scan the project to discover what you can. This single crawl feeds PRODUCT.md, DESIGN.md, **and** the live-mode framework detection in Step 6, so be thorough once rather than re-scanning later:

- **README and docs**: Project purpose, target audience, any stated goals
- **Package.json / config files**: Tech stack, dependencies, existing design libraries, **and the framework** (Vite/SPA, Next.js, Nuxt, SvelteKit, Astro, multi-page static) plus the HTML entry the browser actually loads
- **Existing components**: Current design patterns, spacing, typography in use
- **Brand assets**: Logos, favicons, color values already defined
- **Design tokens / CSS variables**: Existing color palettes, font stacks, spacing scales
- **Any style guides or brand documentation**

Form a **platform hypothesis**:

- Native signals: React Native / Expo (`react-native`, `expo`), Flutter (`pubspec.yaml`, `flutter`), SwiftUI / UIKit (`.swift`, `.xcodeproj`, an `ios/` app target), Jetpack Compose / Android (`build.gradle`, an `android/` app module, `AndroidManifest.xml`). An `ios/` and/or `android/` directory that is a real app target, not just a Capacitor/Cordova wrapper around a website.
- Web signals (the default): a web framework (Vite, Next, Nuxt, SvelteKit, Astro), an HTML entry, a CSS/Tailwind setup, no native app target.

Values: `web` / `ios` / `android` / `adaptive` (one codebase, ships both, adapts per OS). Mobile web is still `web`. This is a hypothesis; Step 3 confirms it when the repo does not make it certain.

Note what you've learned and what remains unclear. Also note any rough edges worth a follow-up command (thin hierarchy, flat or gray palette, missing error/empty states, dull copy); Step 7 turns these into concrete recommendations without re-analyzing.

## Step 3: Ask strategic questions (for PRODUCT.md)

{{ask_instruction}} Ask about anything the codebase doesn't answer with strong, explicit evidence.

### Interview mode, not confirmation mode

If the repo is empty or the user's brief is sparse, run a short interview before proposing PRODUCT.md. Do **not** turn a one-sentence request into a complete inferred PRODUCT.md and ask for blanket confirmation.

- Use the harness's structured question tool when one exists. Otherwise, ask directly in chat and stop: one question at a time, with lettered options where the crawl suggests likely answers, waiting for each answer before the next.
- Keep skill vocabulary (belief ladder, anti-references, visual world) out of question text; ask for the thing in words the user would use.
- Ask in focused rounds and wait for answers between them. Keep **one topic per question**; add rounds rather than fold several topics into one either-or choice. Options obey the same rule: an option answers only the question asked; never write a compound option that bundles a feeling with a business outcome or names an additional audience.
- Use inferred answers as hypotheses or options, not as finished facts.
- Complete at least one real user-answer or approval round before drafting PRODUCT.md. Repo evidence may prefill the proposal, but it does not silently approve strategy or identity.
- Round 1 asks at most three high-leverage questions: who and what job, what makes the product meaningfully different, and what working or cultural world should feel native to it. Confirm platform separately only when repository evidence is ambiguous.
- Add a second round only for a pinned direction, decisive anti-reference, missing proof/content, or accessibility requirement that would materially change the proposals. Do not collect personality adjectives and reference lists by default.

### Minimum viable interview

Ask enough to capture users, purpose, positioning, the audience's working world, and any pinned direction or anti-reference the user actually has. Confirm **platform** (`web` / `ios` / `android` / `adaptive`) when repository evidence is ambiguous. Relevant cultural context, conversion proof, named references, personality, and additional accessibility needs are optional fields, not mandatory interview ceremony. Complete at least one real answer round, then propose only the remaining inferred facts for confirmation before writing. Never synthesize PRODUCT.md from the original task prompt alone.

### Platform

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
- What workflow or decision are they in when they use it?

### Positioning
- In one line, what does this do that nothing else does? The single strategic claim every screen reinforces.

### Brand & Personality
- How would you describe the brand personality in 3 words?
- Reference sites or apps that capture the right feel? What specifically about them?
  - Push for specific named references with the *specific* thing about them that fits this brand, not generic "modern" adjectives or category-bucket lanes.
- What should this explicitly NOT look like? Any anti-references?

### Audience world & direction

The visual world needs roots deeper than a style adjective. Learn the reality the audience already inhabits before proposing a direction:

- What tools, places, objects, documents, materials, or rituals are familiar to them in this context?
- For Persuade and Experience work, what cultural home feels truthful: a place, era, craft, medium, or scene? Ask only for associations that illuminate the product; never force a decorative metaphor.
- Is any visual direction non-negotiable? Preserve the user's exact constraint, whether it is a named aesthetic, an existing identity, a reference, or a deliberate refusal of one.

These are strategic inputs, not a request for the user to design the page. Do not ask them to choose colors, fonts, radii, or a component recipe here. Step 5 turns the confirmed inputs into genuinely different visual-world proposals and asks the user to choose.

### Conversion & proof (Persuade surfaces only)

Ask these only when the current request is a Persuade surface (marketing, landing, campaigns) and the answers are not already in the brief. Experience and Read surfaces get no CTA, belief-ladder, or proof questions; visitor mode is decided per task and is not stored in PRODUCT.md.

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

## Platform

web

## Users
[Who they are, their context, the job to be done. Primary audience; a secondary audience or a surface-vs-user split only when they apply.]

## Product Purpose
[What this product does, why it exists, what success looks like]

## Positioning
[The single strategic claim every screen reinforces. Not a visual rule, not an anti-reference.]

## Audience World
[The tools, places, objects, documents, materials, and rituals familiar to the audience in this context. Include only what the user confirmed.]

## Cultural Context
[The truthful place, era, craft, medium, or scene that can ground Persuade or Experience work. Omit the section when it is genuinely irrelevant to an Operate or Read product.]

## Pinned Direction
[Any visual direction, existing identity, named aesthetic, or reference the user made non-negotiable. Write `None.` when the user explicitly wants the workshop to remain open.]

## Conversion & proof
[Persuade surfaces only (marketing, landing, campaigns). Omit this section entirely, heading included, for Experience, Operate, or Read surfaces.]
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

Platform is `web`, `ios`, `android`, or `adaptive` as a bare value; omit the section only on legacy files you're leaving untouched, otherwise write `web` explicitly.

Write fields as prose, and use bold sparingly: only where a word carries a decision, never as a label lead-in on every line.

For a new context file, write to `PROJECT_ROOT/PRODUCT.md`. When PRODUCT.md was resolved from another supported location, update that exact file instead. If `.impeccable.md` existed, the loader already renamed it; merge into that content rather than starting from scratch.

## Step 5: Establish the visual world (for DESIGN.md)

Identity is not an unattended prelude to the page build. Establish it here, while the user can choose it, and write DESIGN.md before any new-work flow resumes.

### Refinement or extension: document the incumbent world

If the request preserves or extends the current identity and the crawl found an intentional visual system in real code, do not invent a replacement merely because DESIGN.md is missing. Load [document.md](document.md), use scan mode, and show the user the design language you found before writing it down. Ask before replacing an existing DESIGN.md.

### Greenfield or redesign: run the workshop

Run the workshop when the project is visually uncommitted or the user asked for a redesign/rebrand. On redesign, keep the old system visible only long enough to identify what must not survive and which product facts, content, functions, or assets remain useful. Do not offer “the old look, polished” as a candidate world.

1. **Synthesize two or three credible worlds.** Derive them from the confirmed product mechanism, audience world, cultural context, pinned direction, personality, and anti-references in PRODUCT.md. Each proposal must have a distinct identity thesis, layout grammar, type and material character, palette strategy, component character, imagery stance, motion grammar, and one reusable signature. They must be different ways to make *this product* true, not generic category styles with new names. Do not design a particular page here; later craft work composes new surfaces inside the chosen grammar.
2. **Use color entropy as a challenger, never an answer.** If color is genuinely unpinned, run `node {{scripts_path}}/palette.mjs` to challenge the reflex palette. Translate useful tension into a proposal; never let the script override the confirmed brief, pinned direction, existing assets, accessibility, or the user's choice. Structural concept entropy belongs to the task-scoped [new-work.md](new-work.md) flow, not to identity selection.
3. **Ask the user to choose.** Present the directions concisely in the structured question tool when available, one option per world plus a way to revise the premises. Otherwise ask in chat and stop. The user may choose, combine compatible ideas, reject all of them, or tighten the direction. A harness-provided simulated user is a real answer mechanism and must exercise this same turn. Do not silently select a world while a question mechanism exists.
4. **Resolve the chosen world.** Follow up only on choices that materially affect the system. Do not turn this into a token questionnaire. The goal is agreement on a coherent world and its invariants, not approval of every CSS value.
5. **Write a seed DESIGN.md.** Follow the [DESIGN.md format spec](https://raw.githubusercontent.com/google-labs-code/design.md/main/docs/spec.md). Record the chosen thesis, layout behavior, typography direction, color roles, surfaces and materials, components, imagery, motion, and signature. Include concrete values only when the code, assets, palette exploration, or user established them; mark unresolved implementation details as such instead of fabricating a finished token system. Add `<!-- SEED: established with the user before implementation; refresh by scanning the built system -->` near the top. Write a new file at the project root; refresh an existing DESIGN.md at its resolved path.

If there is truly no human or structured question mechanism, derive the proposals anyway, choose the one best supported by the explicit brief and pinned constraints, and add `<!-- UNCONFIRMED ASSUMPTIONS: confirm on the next attended init -->` to both context files. Surface the assumptions in the final response and force confirmation on the next attended init. This is a degraded fallback, not permission for a capable harness to skip the interview or call the world user-approved.

## Step 6: Configure live mode (when code exists)

**Skip this step when the platform is native** (`ios` / `android` / `adaptive`): live mode drives a browser overlay. A hybrid wrapper or Expo web target serving HTML doesn't change that.

If the project has code with HTML entries and a dev server (the same "code exists" condition that puts `/impeccable document` in scan mode), pre-configure live mode now. You already identified the framework and the served HTML entry in Step 2, so this is nearly free, and it spares the user the first-time setup detour when they later run `/impeccable live`.

**Skip this step for empty / pre-implementation projects** (nothing to inject into yet). Tell the user live mode will configure itself the first time they run it once there's code.

**If `.impeccable/live/config.json` already exists, leave it untouched** and note that live mode is already configured.

Otherwise:

1. Write `.impeccable/live/config.json`. Choose `files` (the HTML entries the browser actually loads), `insertBefore`, and `commentSyntax` from the framework table in [live.md](live.md)'s **First-time setup** section, using the framework you found in Step 2. That table is canonical; do not restate it here. For multi-page static sites, prefer a glob (`["public/**/*.html"]`) over a literal list.
2. Run `node {{scripts_path}}/detect-csp.mjs`. If it reports a patchable shape (`append-arrays` / `append-string`), use the **consent prompt template** from live.md before editing any source file. On decline, skip the patch. For `middleware` / `meta-tag` shapes, surface the detected files and ask the user to add `http://localhost:8400` to `script-src` and `connect-src` manually. For `null`, there's nothing to do.
3. Set `cspChecked: true` in the config once CSP is handled (patched, declined, manual, or not needed). The schema and per-shape patch details live in live.md's First-time setup; follow it rather than duplicating.

Writing the config file is harmless and needs no consent; only the CSP **source-file patch** requires a yes.

## Step 7: Recommend starting points, then wrap up

Summarize tersely:
- Platform captured (web / ios / android / adaptive) when relevant
- What was written (PRODUCT.md, the chosen visual world in DESIGN.md, live config, or a subset)
- The 3-5 strategic principles from PRODUCT.md that will guide future work
- If DESIGN.md or live config is pending, one line on how to set it up later

Then recommend the **best commands to run next**, drawn from what your Step 2 crawl already surfaced. Do not run a fresh analysis here; surface observations you already have. Tailor to the current surface and platform, offer the 2-4 most relevant (not a menu dump), and give the exact command to type. Group by intent:

- **Build something new**: `/impeccable craft <feature>` (shape, then build end-to-end) or `/impeccable shape <feature>` (plan first). Lead with this for empty or early-stage projects.
- **Improve what's there**: name the specific surface. `/impeccable critique <page>` for a scored UX review; `/impeccable audit <area>` for a11y / perf / responsive checks; `/impeccable polish <component>` for a pre-ship pass. When the crawl flagged a specific weakness, point the matching command at it: thin hierarchy or spacing → `layout`, flat or gray palette → `colorize`, missing error / empty states → `harden` or `onboard`, dull or unclear copy → `clarify`.
- **Iterate visually** (web only): `/impeccable live` (configured in Step 6) to pick elements in the browser and generate variants in place. **Skip this group for native platforms.**

The full command menu is one bare `/impeccable` away; keep this list short and pointed.

If init was invoked as a blocker by another impeccable command (e.g. the user ran `/impeccable polish` with no PRODUCT.md), resume that original task now. Your own writes are the freshest source; no reload needed.

Optionally {{ask_instruction}} Ask whether they'd like a brief summary of PRODUCT.md appended to {{config_file}} for easier agent reference. If yes, append a short **Design Context** pointer section there.
