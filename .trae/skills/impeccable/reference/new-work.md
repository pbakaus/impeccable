# New identity work

Read this only when the project has no committed visual identity, or the user explicitly asked to replace the current one. A missing DESIGN.md is not enough: code, tokens, chosen type, components, and assets are incumbent design authority. If they exist, preserve and extend them unless the brief says to discard them.

This playbook is task-scoped. PRODUCT.md owns durable product facts and DESIGN.md owns durable visual invariants; the direction for one page or feature belongs in the current task, not in either document.

## Choose the authority

Classify the work before inventing anything:

- **Extend**: an incumbent system exists and the task adds or improves a surface. Preserve its lineage, semantics, and affordances.
- **Surface redesign**: the current identity remains, but this surface may change its topology, hierarchy, and expression.
- **New identity**: nothing committed exists, or the user explicitly authorized a rebrand.

When the evidence is mixed, preserve. Novelty is not permission to erase authored decisions.

## Find the concept

Name the subject, audience, page job, and visitor mode from SKILL.md. Then identify the product's unique mechanism: what it does, proves, or enables that a neighboring product cannot truthfully claim.

Derive the concept from that mechanism through one primary transformation: information topology, evidence, temporal behavior, or spatial mapping. The transformation must change how the surface is organized or behaves, not merely how it is decorated. This produces stranger and more defensible work than imitating a culturally specific document or object. Borrowing a literal cultural form is allowed only when it is genuinely native to the product and audience, and never as costume.

For **Operate** and **Read**, start with the task and information structure. Native controls remain native controls; expression comes from hierarchy, density, rhythm, state, and the system around them. For **Persuade** and **Experience** creating a new identity, explore more freely, but keep the product legible and the primary action obvious.

Run `node .trae/skills/impeccable/scripts/concept-seed.mjs` only for Persuade or Experience new-identity work when two or more directions remain equally credible. It is an entropy source, not an authority: never let the draw overrule the strongest fit. When color is genuinely unconstrained, `node .trae/skills/impeccable/scripts/palette.mjs` may break a reflex palette; subject evidence and incumbent color still win.

## State the direction

Before code, write a task-scoped direction contract of at most 120 words in your reasoning:

- the thesis this surface owns;
- the structural or behavioral transformation;
- what authority is preserved;
- the first viewport's composition and primary action;
- the signature element the surface will be remembered by.

Do not embed this contract as a comment in the production artifact or turn it into a second design system. In an attended substantial build, confirm it once. In an unattended run, record it and continue.

## Build once, commit fully

Plan one compact token system and one layout source: the concept or the content's real structure. Build the strongest coherent direction once. Commitment means the transformation governs the whole surface; it does not mean every control must be rebuilt as a metaphor.

Make the first viewport demonstrate the product's mechanism. Pace long surfaces through contrast in density and scale, and cut sections that only repeat claims. Briefs that depend on imagery ship real, verified imagery. Preserve semantic HTML, familiar interaction behavior, accessibility, and the project's technical conventions.

## Finish proportionally

Inspect desktop and mobile, write one honest critique against the brief and direction, patch material defects, then run the detector once. Repeat only when a real defect remains. A separate reviewer is optional when the harness already provides one and the extra cost is earned by the risk; it is not a default step and its presence is not evidence of quality.
