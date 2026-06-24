# $impeccable auto

Choose and run the right Impeccable workflow from a plain-English request. This command exists so the user does not need to memorize the command catalog.

## Core contract

- Do not ask the user to choose a command.
- Do ask one short clarifying question only when the next action would change the project in meaningfully different ways, such as build new vs rewrite existing, brand vs product, or destructive reduction vs additive polish.
- Prefer acting over presenting a menu. Name the route you chose in one sentence, then do the work.
- Treat the user's words as the target and desired outcome. If the target is vague, infer from the current file, route, dirty tree, or nearest visible UI file before asking.
- When the request spans disciplines, pick one primary command and load supporting command references for the parts that matter.

## Decision workflow

1. **Setup and target.** Setup has already run in the parent skill. Use its context, the register reference, and the representative project file you read. Resolve the most concrete target you can.
2. **Classify intent.** Identify the dominant job:
   - New feature, page, or substantial rebuild -> `craft`.
   - Need a plan before build -> `shape`.
   - First project setup or missing context -> `init`.
   - Capture or repair the design system -> `document` or `extract`.
   - Review, score, or decide what is wrong -> `critique`.
   - Accessibility, performance, responsive, theming, or detector quality -> `audit`.
   - Looks almost done but rough -> `polish`.
   - Too bland, generic, or safe -> `bolder`.
   - Too loud, busy, or aggressive -> `quieter` or `distill`.
   - Production edge cases, long text, i18n, errors, or resilience -> `harden`.
   - First-run flows, empty states, or activation -> `onboard`.
   - Motion, hover, transitions, or perceived liveliness -> `animate`.
   - Flat, gray, dull, or weak palette -> `colorize`.
   - Fonts, hierarchy, reading rhythm, or text sizing -> `typeset`.
   - Spacing, alignment, density, composition, or page structure -> `layout`.
   - Personality, charm, or memorable detail -> `delight`.
   - Extreme technical ambition or "wow" -> `overdrive`.
   - UX copy, labels, error messages, or instructions -> `clarify`.
   - Mobile, tablet, responsive, print, or cross-device behavior -> `adapt`.
   - Slow, janky, heavy, or loading badly -> `optimize`.
   - Browser element picking and visual alternatives -> `live`.
3. **Choose a primary command.** The primary command owns the flow and the final output. Load `reference/<primary>.md` and follow it.
4. **Add supporting commands.** Load supporting references only when they materially change the work. Keep the set small:
   - "Make this page good" -> primary `polish`, support `layout`, `typeset`, `colorize`, `harden` as needed.
   - "This landing page feels generic" -> primary `bolder`, support `critique`, `typeset`, `colorize`.
   - "Checkout is confusing on mobile" -> primary `adapt`, support `clarify`, `harden`, `audit`.
   - "Dashboard looks dense and hard to scan" -> primary `layout`, support `typeset`, `distill`, `clarify`.
   - "Ready to ship?" -> primary `audit`, support `critique`, then route fixes to `harden` and `polish`.
5. **Use evidence.** Run the bundled detector when local scannable targets exist:
   ```bash
   node .agents/skills/impeccable/scripts/detect.mjs --json <target>
   ```
   Exit 0 means no deterministic findings. Exit 2 means findings exist. Fold the evidence into route choice and priorities. Do not let a clean detector result override visual judgment.
6. **State the route.** Before edits or a report, say: "Auto route: `<primary>` with `<supporting>` because <short reason>." Then execute the selected flow.
7. **Finish with what changed or what to do next.** If you edited code, summarize changes and verification. If you produced a report, end with the recommended next command already chosen, not a menu.

## Command bundle guidance

Use bundles for common natural-language requests:

| Request shape | Primary command | Supporting commands |
|---|---|---|
| "Make it better" / "looks off" | `polish` | `layout`, `typeset`, `colorize`, `clarify` |
| "What is wrong with this?" | `critique` | `audit` |
| "Can we ship this?" | `audit` | `harden`, `polish` |
| "Build a new page/feature" | `craft` | `shape`, `document` |
| "Too boring/generic" | `bolder` | `colorize`, `typeset`, `delight` |
| "Too busy/loud" | `quieter` | `distill`, `layout` |
| "Mobile is bad" | `adapt` | `harden`, `audit` |
| "Copy is confusing" | `clarify` | `onboard`, `harden` |
| "Feels slow/janky" | `optimize` | `animate`, `audit` |

## Tie-breakers

- If the user asks for a deliverable to be built, choose `craft` over `critique`.
- If the user asks for diagnosis, choose `critique` or `audit` before `polish`.
- If the user says "ship", "production", "edge cases", or mentions real data, choose `harden` or `audit` before aesthetic refinements.
- If the problem is visual but not functional, choose `polish` before `harden`.
- If the request is about one visible dimension, use the specialist command rather than a broad pass.
- If two commands are equally plausible and both are low-risk, pick the one that changes less code first.

## Never

- Do not dump the full command list as the main answer.
- Do not tell the user to pick between commands when the request provides enough intent.
- Do not run every command. A smart route is selective.
- Do not skip setup, register, or project-file discovery just because this is an automatic route.
- Do not treat `auto` as weaker than specialist commands. It is a router and orchestrator, not a fallback.
