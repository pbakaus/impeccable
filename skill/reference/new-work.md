# Surface concept and craft

This is the shared task-scoped concept playbook for `craft`, `shape`, and substantial from-scratch surface work. `craft` continues through the contract, build, and finish below. `shape` follows this file through the user's concept choice, then reads [shape.md](shape.md), writes the design brief, and stops before code. PRODUCT.md owns durable product truth; DESIGN.md owns the current user-approved visual world.

If PRODUCT.md or DESIGN.md is missing, stop and complete [init.md](init.md) first. For refinement, init documents coherent incumbent visual code instead of inventing a replacement. For redesign, init replaces the old visual world before returning here; the old system is evidence and anti-reference, not authority.

**A committed world does not decide the new surface.** Every case study, dashboard view, feature page, or section still needs an ownable task concept. The job here is to invent that concept with the user without re-rolling the brand.

## Name the work

Use the user's intent, not the age of the codebase:

- **Greenfield** creates the first surface inside the world init just established.
- **Redesign** composes inside the replacement world init just established. Preserve product truth, real content, functionality, and native affordances; do not preserve the discarded look by habit.
- **Extension** adds a new surface inside the committed world. Preserve its lineage and interaction conventions while giving this task its own composition.
- **Refinement** belongs to the invoked refinement command, not this full concept flow. Preserve the incumbent world and named scope.

If “redesign” could mean either a replacement identity or an on-brand structural adjustment, use the structured question tool to resolve that single ambiguity before proceeding. A plain “redesign this page/site” means replacement; “within the current brand/system” means extension or refinement.

## Discover the surface

Name the subject, audience, surface job, visitor mode, real content, and primary action. Read PRODUCT.md and DESIGN.md as anchors, but ask about what is unique to this task. A case-study section, for example, needs the proof available, the transformation it must make legible, the audience's reading order, and the moment worth remembering; the global brand interview cannot answer those.

In an attended run, ask a focused round of no more than three task questions, then wait. Use the structured question tool when available. Do not re-ask durable questions already settled in PRODUCT.md or DESIGN.md. A harness-provided simulated user is attended and must receive the same questions.

For a narrow request whose content, outcome, and constraints are already explicit, assert what you understand and ask the user to confirm or correct it. Do not manufacture an interview when there is no material uncertainty.

## Develop the surface concept

The visual world supplies the vocabulary; the task concept supplies the sentence.

1. **State the mechanism.** In one sentence, name what this surface does, proves, or enables that a neighboring product could not truthfully claim.
2. **Expose the defaults.** Describe the category's habitual arrangement and the predictable contrarian response. Treat both as warnings, not automatic answers.
3. **Derive structural material.** From the task's real content, PRODUCT.md's audience world, and DESIGN.md's existing motifs, list five to seven forms, documents, rituals, spatial arrangements, or behaviors that could carry the mechanism. Translate their reading order and relationships, not their costume, into interface structure.
4. **Break the model's ranking rut.** For substantial greenfield, redesign, or extension work, run `node {{scripts_path}}/concept-seed.mjs`. Use its assigned index to promote one overlooked grounded candidate, and weigh its challengers only on audience identification and product clarity. A challenger may change topology or interaction, but it may not override the current DESIGN.md. Skip the seed for a small extension or when the user has already pinned the surface concept.
5. **Offer real choices.** Present two or three materially different surface concepts. For each, give the layout or interaction thesis, narrative sequence, first-view or focal moment, signature use, and why it belongs in the committed world. These are not moodboards with different adjectives; the content must be organized or experienced differently.
6. **Let the user direct.** Ask which concept is closest, what to combine, and what feels wrong. The user may reject all of them. Resolve the chosen concept before code. If one direction is overwhelmingly supported, assert it and ask for confirmation instead of staging a fake menu.
7. **Probe when pictures would clarify structure.** When the harness has native image generation and the substantial, high-fidelity surface would benefit from a visual test, load [codex.md](codex.md) before writing the direction contract. Its probes stay inside DESIGN.md and pressure-test the shortlisted surface concepts; they never reopen palette, typography, or identity. Skip it for narrow extensions, low-fidelity work, or when the user already supplied an approved comp.

When no human or structured question mechanism exists, follow the same derivation, build the seed's assigned grounded candidate when it survives the two tests, record the decision, and continue. Unattended does not mean unconsidered; external selection is what prevents the model from quietly returning to its own first choice.

For `shape`, stop here after the user selects the concept and continue in [shape.md](shape.md). Do not write a direction contract or implementation.

## Write the direction contract

Before code, write the chosen task direction as a contract of at most 150 words. Place it in an opening HTML comment or framework comment block so the Impeccable Stop hook can audit the render against it. The first 200 characters of the comment must name `DIRECTION CONTRACT`.

Use these six short blocks:

- `UNIQUE`: the surface thesis tied to the product mechanism;
- `NOT-TEMPLATE`: the category-default arrangement this structure refuses;
- `OWN-WORLD`: the specific current DESIGN.md invariants, tokens, and materials it uses;
- `STORY`: what the visitor understands, believes, and does from entry to action;
- `FIRST VIEWPORT`: the exact composition, hierarchy, and primary action (or the equivalent first task for a product surface);
- `FORM`: the chosen structural or behavioral form, its signature, and the concept-seed key when one was used.

The contract is not visitor-facing content and not a second design system. It makes the task's promise inspectable. The user's selected concept is the authority; the seed is only provenance. <!-- rule:skill-decide-then-build -->

## Plan, self-check, build

Plan how the chosen concept uses the current DESIGN.md's tokens or directions, reusable technical components, imagery language, and motion grammar. In a redesign, replace visual tokens from the discarded system rather than preserving them through implementation convenience. The layout has two legitimate sources: the concept and the content's real structure. The category's habitual skeleton is neither. Compare the plan with what you would produce for a neighboring product; wherever they converge for no product-specific reason, revise the generic part.

Build the strongest coherent direction once. Commitment means the concept governs the entire requested surface; it does not mean disguising familiar controls as metaphors or violating the design system.

**Make the opening a thesis.** The first viewport or first task should demonstrate the product's mechanism, not wrap a generic promise in generic chrome. If someone leaves after that moment, they should remember an idea or interaction, not merely a mood.

**Pace the whole surface.** Long surfaces are a rhythm, not a stack. Vary density, scale, image, and quiet inside DESIGN.md's grammar. A case study should reveal evidence in the order it becomes persuasive; an Operate flow should reveal control in the order the task demands. Cut sections that only repeat claims.

**Commit before correcting.** Land the chosen concept at full strength before the finishing pass makes it clear, usable, and effective. Do not weaken the hard creative move in anticipation of a generic “too gimmicky” critique; the measured failure is partial commitment, not excess conviction.

**Make the signature structural.** Use the world's signature where the task concept peaks, at enough scale or consequence that the composition organizes around it. Scattering a motif as decoration is not commitment.

**Prove, don't claim.** Show the mechanism working, the actual artifact, the before-and-after, the data, or the specific content. A surface earns belief through evidence a competitor could not copy-paste.

For Operate and Read, familiar controls and comprehension remain primary; expression comes from topology, hierarchy, density, rhythm, state, and the system around them. For Persuade and Experience, dramatic pacing and art direction are available when the selected concept earns them, while the primary action and reading order stay clear.

Briefs that depend on imagery ship real, verified imagery. Preserve semantic HTML, familiar interaction behavior, accessibility, performance, responsive behavior, and the project's technical conventions.

## Finish like a studio

Inspect desktop and mobile, write one honest critique against the task brief, DESIGN.md, the user's selected concept, and the direction contract, then patch material defects. Judge the skeleton skin-blind: mentally remove color, type, texture, and concept nouns; if the remaining block arrangement is the category template, rebuild the structure. Run the detector once. On harnesses with a Stop hook, let its contract audit run and fix every real gap it identifies; classify false positives rather than distorting intentional work. Repeat only while a real defect remains. A separate reviewer is optional when the harness provides one and the risk earns the cost. <!-- rule:skill-finish-like-studio -->
