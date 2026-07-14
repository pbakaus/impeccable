# Shape

Discover what should be made and how it should work, then return a confirmed design brief without code.

## Phase 1: Discovery interview

Do not write code or choose visual direction yet.

### Cadence

- Use the structured question tool when available; otherwise ask and stop.
- Ask two or three related questions per round, then wait. One round is the default; add a second only when the answers expose a material gap.
- Do not dump a questionnaire, repeat settled facts, or turn obvious facts into menus. Assert the likely reading and invite correction.
- A sparse prompt requires at least one answer round. A precise prompt may need only a compact confirmation.

### Round 1: purpose, people, and outcome

Choose the two or three questions that most change the result:

- What is this surface or feature for, and what problem must it solve?
- Who specifically reaches it, in what situation and state of mind?
- What is the primary thing they must understand or do? What would success look like?
- What is uniquely true here that a neighboring product or generic template could not claim?

### Round 2: material, behavior, and boundaries

Run only for material unresolved decisions:

- What real content, evidence, data, and assets must the experience carry? What are realistic minimum, typical, and maximum ranges?
- Which states and transitions matter: first-run, empty, loading, error, success, permissions, overflow, or expert use?
- What is the intended fidelity, breadth, and interactivity: exploration, production-ready screen, full flow, or broader surface?
- What must remain untouched? What would make the result feel wrong even if it looked polished?
- Which platform, framework, performance, accessibility, localization, or delivery constraints are binding?

Never ask for CSS values or canned aesthetic lanes. New-work owns visual-world and concept choices.

## Phase 2: Resolve the design direction

For new surfaces, brand expansion, or replacement, follow [new-work.md](new-work.md) through visual authority, any world workshop, and concept choice. Reuse discovery, then return before its contract, persistence, or implementation. Inside an established world, use its concept process only when composition or interaction remains materially open.

## Phase 3: Write the brief

Write the smallest useful brief:

1. **Job and audience:** who arrives, their context, need, and visitor mode.
2. **Outcome and proof:** primary task/action, success, real evidence, and product-specific truth.
3. **Selected direction:** visual authority, structural/interaction thesis, sequence, focal moment, and implementation consequence.
4. **Scope and boundaries:** fidelity, breadth, interactivity, named target, what remains untouched, and explicit anti-goals.
5. **States and ranges:** realistic content/data ranges and material states.
6. **Interaction and layout:** hierarchy, topology, responsiveness, affordances, feedback, and transitions; intent, not CSS.
7. **Constraints and open decisions:** platform, delivery, accessibility, localization, reusable components, and choices a builder must not invent.

Use three to five bullets when the task is settled; use the full structure only for ambiguous, multi-screen, or standalone planning. Do not restate the conversation.

## Confirm and stop

Present the brief for explicit confirmation or one correction round, then stop: shape never writes code or a direction contract.

### Constraints
- Are there technical constraints? (Framework, performance budget, browser support)
- Are there content constraints? (Localization, dynamic text length, user-generated content)
- Mobile/responsive requirements?
- Accessibility requirements beyond WCAG AA?

### Anti-Goals
- What should this NOT be? What would be a wrong direction?
- What's the biggest risk of getting this wrong?

## Phase 1.5: Visual Direction Probe (Capability-Gated)

After the discovery interview, generate a small set of visual direction probes **before** writing the final brief when all of these are true:

- The work is **net-new** or directionally ambiguous enough that visual exploration will clarify the brief.
- The requested fidelity is **mid-fi, high-fi, or production-ready**. Skip for sketch-only planning.
- The current harness gives you native image generation (Codex's `image_gen`, an equivalent MCP tool, or similar). Don't ask the user to install APIs or tooling.

When those conditions are met, this step is mandatory. If image generation isn't natively available, do not ask the user to install APIs or tooling. State in one line that the image step is skipped because the harness lacks native image generation, then proceed. The one-line announcement is required, not optional; it forces a conscious decision instead of letting the step quietly evaporate.

Use probes to explore visual lanes, not to replace the brief.

Do not skip probes because the final UI will be semantic, editable, code-native, responsive, or accessible. Those are implementation requirements, not reasons to avoid visual exploration.

### What to generate

Generate **2 to 4** distinct direction probes based on the discovery answers, especially:

- Color strategy
- Theme scene sentence
- Named anchor references
- Scope and fidelity

The probes should differ in primary visual direction (hierarchy, topology, density, typographic voice, or color strategy), not just palette tweaks.

### How to use the probes

- Treat them as **direction tests**, not final designs.
- Use them to pressure-test whether the brief is pointing at the right lane.
- Ask the user which direction feels closest, what feels off, and what should carry forward.
- If the probes reveal a mismatch, revise the brief inputs before finalizing the brief.

### Important limits

- Do **not** skip discovery because image generation is available.
- Do **not** treat generated imagery as final UX specification, final copy, or final accessibility behavior.
- Do **not** use this step for minor refinements of existing work. It's for shaping a new surface or clarifying a big directional choice.

If image generation isn't natively available, announce the skip in one line and proceed to the design brief.

## Phase 2: Design Brief

After the interview and any required probes, present a brief and **end your response**. The user must confirm before any implementation runs. Do not present a brief and then continue to code in the same response, even if the brief feels obvious to you. The user's confirmation is the gate.

**Choose the brief shape based on how clear the answers are:**

- **Compact form (3-5 bullets)** when discovery was crisp and the original prompt + PRODUCT.md already pinned scope, content, and direction. State what you're building, the visual lane, and end with one or two specific questions or a clear "confirm or override?" prompt. This is the default for typical craft requests with a clear prompt.
- **Full structured form (sections below)** when the task is genuinely ambiguous, multi-screen, or when the user asked for shape as a standalone step. Use this when the discipline of structure earns its weight.

Don't pad a clear brief into a long one to look thorough. A 70-line brief restating answers the user just gave is noise, not rigor. Equally, don't skip the confirmation pause to look efficient: the pause is the point.

Present the brief, then **stop and wait for explicit confirmation**. You are not the judge of whether the user already approved. Even when the brief feels obviously right, ask once and wait. The pause is what separates shape from premature implementation.

### Brief Structure

**1. Feature Summary** (2-3 sentences)
What this is, who it's for, what it needs to accomplish.

**2. Primary User Action**
The single most important thing a user should do or understand here.

**3. Design Direction**
Color strategy (Restrained / Committed / Full palette / Drenched) + the theme scene sentence + 2–3 named anchor references. Reference PRODUCT.md and DESIGN.md where they already answer, and note any per-surface overrides.

If you ran the Visual Direction Probe step, name which probe direction won and what changed in the brief because of it.

**4. Scope**
Fidelity, breadth, interactivity, and time intent from the Scope section of the interview. Task-scoped; these don't persist beyond the brief.

**5. Layout Strategy**
High-level spatial approach: what gets emphasis, what's secondary, how information flows. Describe the visual hierarchy and rhythm, not specific CSS.

**6. Key States**
List every state the feature needs: default, empty, loading, error, success, edge cases. For each, note what the user needs to see and feel.

**7. Interaction Model**
How users interact with this feature. What happens on click, hover, scroll? What feedback do they get? What's the flow from entry to completion?

**8. Content Requirements**
What copy, labels, empty state messages, error messages, and microcopy are needed. Note any dynamic content and its realistic ranges. For image-led surfaces, also list the required image/media roles and their likely source (project asset, generated raster, semantic SVG/CSS, canvas/WebGL, icon library, or accepted omission).

**9. Recommended References**
Based on the brief, list which impeccable reference files would be most valuable during implementation (e.g., layout.md for complex layouts, animate.md for animated features, interaction-design.md for form-heavy features, typeset.md for typography-driven pages, colorize.md for color-led brands).

**10. Open Questions**
Anything genuinely unresolved. Don't list "open questions" you've already recommended a default for; assert the default and move on. If you'd write `Recommend: X` next to a question, just decide X.

---

{{ask_instruction}} Ask for explicit confirmation of the brief before finishing.

If the user disagrees with any part, revisit the relevant discovery questions. A shape run is incomplete until the user confirms direction.

Once confirmed, the brief is complete. The user can now hand it to {{command_prefix}}impeccable, or use it to guide any other implementation approach. (If the user wants the full discovery-then-build flow in one step, they should use {{command_prefix}}impeccable craft instead, which runs this command internally.)
