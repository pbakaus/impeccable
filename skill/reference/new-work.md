# New visual work

This flow owns the durable visual world when authority is absent, expanding, or explicitly replaced, plus only as much task-level shaping as the requested scope needs. PRODUCT.md owns product truth, DESIGN.md confirmed visual truth, and `.impeccable/surfaces/` durable task strategy. Complete [init.md](init.md) first when PRODUCT.md is missing. Missing DESIGN.md does not route back to init.

## Vocabulary

Terms this file uses throughout, defined once:

- **World:** the durable visual identity: palette, materials, type voice, ornament logic, and component character that outlive any single surface.
- **Coupled pair:** one world joined to one concrete first-surface expression, selected together as a single decision, never as two tournaments.
- **Staging:** an identity-free structural idea for a surface (hierarchy, sequence, interaction). The seed may append several; they bring no palette, typeface, or material.
- **Candidate floor:** the five veto tests in section 4. A candidate passes all five or is discarded and replaced.
- **Direction contract:** six promise blocks written into the artifact's opening comment before code, audited against the render by the hooks.
- **Surface brief:** durable surface strategy persisted to `.impeccable/surfaces/` via `surface-brief.mjs`.
- **Attended run:** a user is present to answer questions. Unattended fallbacks apply only when no one can answer.

## 1. Name the intent

- **Greenfield:** no coherent visual implementation.
- **Local extension:** a section, feature, component, or state inside an established surface and world.
- **New surface:** a whole page, route, screen, flow, or standalone experience inside an established world.
- **Expression expansion:** an established brand entering an unresolved whole-surface family or app boundary.
- **Redesign/rebrand:** replace the world while preserving unchanged product truth, content, function, native affordances, constraints, and brand commitments.
- **Refinement:** leave this flow for the scoped command; preserve the world and scope.

Classify before ideation: work that must join an existing page is a local extension, and a novel layout it would benefit from does not promote it to a new surface. A plain "redesign this page/site" authorizes replacement. "Redesign this within the current brand/system" means extension or refinement. Ask once only when the wording is genuinely ambiguous.

## 2. Resolve visual authority

Read DESIGN.md and representative code, tokens, components, and assets. Choose one path:

- **A. Explicit redesign.** The old DESIGN.md and implementation are not authority. Keep only unrevoked product facts, content, function, native expectations, constraints, and brand commitments. Establish a replacement world.
- **B. DESIGN.md covers this kind of surface.** Use its invariants and normative tokens; skip world-building and discover the surface.
- **C. Coherent implementation, no DESIGN.md.** Code, assets, tokens, type, and component behavior are incumbent authority. Run [document.md](document.md) in scan mode, confirm the extracted invariants, then write DESIGN.md. Do not offer replacement worlds unless the user asked for a redesign.
- **D. Brand exists, whole-surface family unresolved.** Preserve logo, color/type assets, voice, recognizable component/motion traits, and constraints. Ask what must carry and where expression may expand; offer two or three compatible ranges, not replacement identities, and merge the choice into DESIGN.md (child-app DESIGN.md when the range is local).
- **E. No confirmed visual authority.** Establish a world. Scaffolds, framework defaults, and stray utilities are not identity.

A local extension stays on B or C: its surrounding surface is authority even when DESIGN.md is incomplete.

## 3. Discover the requested surface

Name this surface's audience, job, visitor mode, real content, primary action/task, evidence, constraints, and memorable moment. PRODUCT.md supplies truth and DESIGN.md the world; neither decides narrative or composition.

In an attended run, ask one round of at most three material questions without repeating durable facts: CTA hierarchy, proof sequence, content gaps, and interaction outcomes belong here, not in PRODUCT.md. For a fully specified narrow request, state the interpretation and invite correction. When `shape` has already completed its discovery interview, reuse those confirmed answers and do not ask again.

## 4. The candidate floor

When generating choices, veto rather than rationalize. Before a candidate reaches the user, discard and replace it if any floor fails:

- **Truth:** every product relationship it visualizes exists; resemblance is not evidence.
- **Translation:** remove the literal source prop and label. A coherent product-native experience must remain, still carrying the source's aesthetic and compositional laws. Function without that character is safe flattening; character without product structure is costume.
- **Signature:** one authored move makes the experience unmistakable and materially shapes implementation. Name what the visitor experiences and what becomes possible; routine state or polish does not pass.
- **Survival:** its identity and signature remain compelling on the primary device within the real asset and tool budget.
- **Fit:** its risk is an honest tradeoff, not a probable violation of the brief or audience.

Passing some floors never rescues a failed one. The selected signature becomes the direction contract's `BAR-RAISER`.

## 5. Shape or select the direction

Do not select a new world and its first surface concept in separate tournaments. That creates a safe global choice followed by a more interesting local choice whose "lineage" exists only in prose. Pick the one lane that matches the intent and authority path.

### Local extension (B or C): inherit, do not reseed

Inherit both the world and the surrounding surface's direction. Resolve only the decisions the addition actually introduces: purpose, content, hierarchy, state or interaction, and how it joins the existing sequence; in an attended run use short, related question rounds while those are open. Do not run `concept-seed.mjs`, generate competing surface metaphors, offer alternate worlds, write a direction contract, or change DESIGN.md without user approval. The result may still have an authored, surprising layout; its novelty must come from the material and the established grammar, not a new identity thesis. If the request reveals a genuine gap in the brand system, name the gap and ask before treating it as path D; never silently turn a section into an expression-expansion exercise.

### New surface inside stable authority (B or C)

The world supplies the vocabulary; the task concept supplies the sentence.

1. Derive five to seven structural candidates from the content, mechanism, audience, and confirmed authority. Translate its relationships and behavior, not just its styling.
2. Run `node {{scripts_path}}/concept-seed.mjs --scope surface --mode <mode>` (the surface's mode: persuade, operate, read, or experience) only when a whole page, route, screen, flow, or standalone experience calls for high-concept exploration. Otherwise shape the strongest grounded structure directly. Never run it for a local extension. Translate every supplied STAGING CHALLENGER into this product's content and behavior, dress it in the committed identity, and compare it with the grounded structures; the point is to challenge the habitual layout, not append a flourish.
3. Name the habitual arrangement and predictable contrarian response. Apply the candidate floor, then judge survivors skin-blind: topology, sequence, or interaction must remain different after names and styling disappear.
4. When materially different whole-surface choices would help, present two or three neutral options with thesis, sequence, focal moment, signature, implementation consequence, and concrete inherited world rules, following **Present, visualize, re-roll** below. Let the user select or revise before code.

Unattended: use the promoted candidate when a roll ran, otherwise the strongest grounded structure; it must survive both tests.

### New or replacement world (A, D, or E): choose a coupled pair

1. **Ground.** Derive the product mechanism, user scene, audience's cultural home, and what this surface uniquely proves. Name the category default and its predictable contrarian response; neither may enter the shortlist unchanged.
2. **Derive pairs.** Generate five to seven grounded coupled pairs and order them by product fit. Each joins a durable system to a concrete first-surface structure, native behavior, non-routine signature move, and implementation consequence. Different names or materials on the same experience are one candidate.
3. **Break the ranking rut once.** Run `node {{scripts_path}}/concept-seed.mjs --scope direction --mode <mode>`, where the mode is the first surface's: persuade, operate, read, or experience. The seed names a PROMOTED INDEX; elevate the pair at that position of your own ranked list into the serious shortlist and judge it as a peer of your top picks. For each world challenger, translate its system laws (material behavior, type/composition, topology, state, and motion) into product-native equivalents. Remove the literal carrier, not the character that made the source worth entering. Compare every translated pair with the grounded list on audience identification, product clarity, system leverage, and use of the medium. Translate each supplied FIRST-SURFACE STAGING into one concrete product structure and use the set to challenge your own habitual composition; when one survives, bind it to the world as one coupled decision.
4. **Test at full strength.** Apply the candidate floor. Strip names, styling, and source carrier; survivors must still differ in structure, sequence, or interaction. Their world must also govern the whole product: the navigation, a dense surface, and a quiet surface, with the last two dissimilar.
5. **Offer coupled choices.** Present two or three equally viable pairs without recommendation cues, following **Present, visualize, re-roll** below. For each, show the world rules, first-surface expression, signature move and implementation consequence, cross-surface breadth, and risk. If fewer than two clear every veto, derive replacements rather than padding the choice. Ask what is closest, should combine, or feels wrong; rejection is allowed.
6. **Resolve once.** The user selects or revises the pair. Extract the durable rules into DESIGN.md and the task-specific strategy into the surface brief; do not reopen either half independently.

Unattended: use the assigned grounded pair only if it survives product fit, coupling, and breadth; mark assumptions. This is fallback, not user choice.

### Present, visualize, re-roll

These rules govern every candidate presentation above, in either lane.

When the harness can generate images, visualizing the finalists is required, not decoration: render each presented candidate as a world board (palette, materials, type voice, component character) plus a first-surface mock at a realistic viewport; a surface-scope candidate inside a committed world gets the mock alone. Render designed artifacts: invented product names, real English interface copy, no instruction text transcribed onto the image, no dashboard or game chrome the concept itself did not earn. The images are selection aids only; the direction contract and DESIGN.md stay the sole authority, and no image persists as a project file.

Always offer **re-roll** beside the candidates, with an optional one-line steer for what is missing. Re-roll eliminates every candidate presented so far, grounded and challenger alike; none may return reworded. Derive genuinely new grounded candidates from unexplored angles of the same grounding, honor the steer, rerun the seed with `--from <key> --reroll <round>` so it draws challengers it has not yet shown, apply the candidate floor, rerank, and present again under these same rules. After two consecutive re-rolls, ask what quality is missing before rolling a third time; silent re-rolls converge on guessing.

An unattended run has no one to re-roll or eye-test. When image generation is available there, render one mock of the chosen direction and correct material drift between mock and build before finishing.

For a substantial high-fidelity surface with native image generation, load [codex.md](codex.md) after selection; probes stay inside the selected direction. For `shape`, stop after selection and continue in [shape.md](shape.md).

## 6. Expand, then contract, the chosen direction

If a competent default could satisfy the concept, sharpen its focal moment until one product-specific move changes implementation and raises the experience above competent convention.

Before compressing the decision, expand one coherent studio plan in working context:

- **Spatial:** the whole-surface composition, navigation, reveals, and rhythm, not only section order.
- **Motion:** the coordinated motion story and its major moments, not a list of repeated effects.
- **Interaction:** the flagship experience, its feedback, and what the visitor can understand or do through it.
- **Narrative:** how copy, evidence, and action build one persuasive or usable arc.
- **System:** how the world governs components, dense and quiet surfaces, states, and responsive behavior.

Make concrete decisions in every relevant discipline and make them cause one another. Do not use the list to decorate an unchanged page skeleton.

Before code, write a direction contract of at most 150 words in the artifact's opening HTML or framework comment; the first 200 characters must name `DIRECTION CONTRACT`. The artifact comment is the contract's only home: hooks audit the render against it, and the surface brief references it rather than duplicating it. <!-- rule:skill-decide-then-build -->

- `THESIS`: the product-specific idea and the category-default arrangement it refuses;
- `OWN-WORLD`: the confirmed DESIGN.md invariants, tokens, and materials it uses;
- `STORY`: what the visitor understands, believes, and does;
- `FIRST VIEWPORT`: exact composition, hierarchy, action, and where the concept exceeds competent convention;
- `BAR-RAISER`: the selected signature move: what the visitor experiences, what it makes possible, and the implementation consequence that keeps the surface from collapsing to a competent default;
- `FORM`: chosen structure or behavior, signature, implementation consequence, and seed key.

The contract is task-scoped, inspectable, and subordinate to the user's choice. A local extension skips it unless the user explicitly wants the addition to become a distinct authored moment; the shaped decisions are its implementation plan instead.

## 7. Persist the surface brief

Once the primary target or route is known, persist durable surface-level product/UX strategy separately from PRODUCT.md and DESIGN.md. `<primary-target>` is a concrete repo-relative source file path or route URL, never a natural-language description; the script derives the clone-stable slug mechanically, so never hand-write one. Prefer a clone-stable source file; map routes and alternate entries as related targets. For a local extension, update the parent surface's record only when the work establishes durable product strategy; do not create a component-level brief by reflex. Read any record first:

`node {{scripts_path}}/surface-brief.mjs read <primary-target>`

Exit 0: preserve still-valid decisions and change only what the user changed; for redesign, retain valid product strategy, content, function, and open decisions while replacing the visual direction. Exit 2: no brief exists. Write with `node {{scripts_path}}/surface-brief.mjs write <primary-target> <body-file> [related-target ...]`, which persists `.impeccable/surfaces/<target-slug>.md` as durable context for later sessions; leave version control to the user's normal flow. Exclude global truth, exact tokens, transient notes, and work logs. The concise body:

```markdown
# Surface brief: [name]

## Scope
[Primary/related route or artifact, visitor mode, and what this surface owns.]

## Product strategy
[Surface-specific audience and job, desired outcome, primary/secondary action or task, content and proof sequence, factual constraints, and explicitly open decisions.]

## Selected direction
[Reference to the applicable DESIGN.md world or expression range, selected surface concept, focal moment, narrative/interaction sequence, implementation consequence, and a pointer to the artifact carrying the direction contract.]

## Open decisions
[Only unresolved items that later work must not silently invent. Omit when empty.]
```

## 8. Write or update DESIGN.md

For A or E, write or replace DESIGN.md at the resolved project/app boundary; for D, merge only the approved expansion range. The format, in brief: YAML frontmatter carrying machine-readable tokens (colors, typography, rounded, spacing, components), then the canonical markdown sections in fixed order, with tokens normative and prose as application context. [document.md](document.md) carries the full schema and examples; never fetch a remote spec. Record the chosen durable rules and add:

`<!-- STATUS: DIRECTIONAL SEED; exact tokens remain provisional until the first implementation pass. -->`

Do not fabricate YAML tokens; add exact values only after the user, assets, or implementation establishes them. The selected pair authorizes its world and first expression together without another confirmation. A local extension does not change DESIGN.md unless the user approves a durable system addition.

## 9. Plan and build

Plan from the selected direction or local shape and real content, never a category skeleton. In redesign, remove inherited visual tokens. Load only needed specialist references; focal interaction or authored animation reads [animate.md](animate.md), even without the `animate` command.

Build the strongest coherent direction once. Its grammar governs navigation, actions, controls, content, and transitions without disguising affordances. Give the focal form the scale that gives it force; do not trap it inside a conventional opening panel.

- **Make the opening a thesis.** Demonstrate the mechanism immediately; leave an idea, interaction, or evidence, not merely mood.
- **Commit before correcting.** Land the hard move at full strength before refining it. In unattended work, safety is the known risk.
- **Commit at page scale.** Let color, material, image, or type own a region when the world calls for it. Scattered signature decoration is not commitment.
- **Pace the whole surface.** Vary density, scale, image, motion, and quiet inside one grammar. Cut repeated claims; prove the mechanism with real artifact, interaction, data, transformation, or content.
- **Author motion as material.** Motion expresses the world and task. Premium moments go beyond repeated transform/opacity through earned focus, depth, masks, continuity, light, or material change. Bound expensive effects, test in-browser, and keep content visible by default.

Preserve semantics, affordances, accessibility, performance, responsiveness, and project conventions. Operate/Read express through topology, hierarchy, density, rhythm, and state; Persuade/Experience may earn drama.

## 10. Solidify the visual record

After first implementation of a new/replacement world or approved expansion, refresh DESIGN.md from the build: replace provisional direction with the exact type, color roles, tokens, spacing/radii, components, states, and motion that survived; add normative YAML tokens only for values the implementation actually uses; remove the directional-seed status once record and implementation agree; preserve broader world invariants and expression ranges. Do not promote the task's story, opening composition, or one-off motif into a global rule unless it is intentionally reusable. Ordinary extension does not rewrite DESIGN.md; only approved durable changes do.

## 11. Finish like a studio

Inspect desktop and mobile; critique against the brief, DESIGN.md, and the applicable shape, concept, or contract; patch material defects; recheck skin-blind. Follow the quality guidance supplied by `context.mjs` and hooks. Context requests a manual scan only when no automatic detector is active; never add another detector pass. Fix real gaps and classify false positives until none remain. <!-- rule:skill-finish-like-studio -->

When the harness can run a separate agent, this finishing review belongs there, not in the build thread: hand the reviewer the artifact path, its direction contract, and the detector command, and have it return a short list of material fixes; apply them and finish. A fresh reader catches what the builder's own eyes slide past. <!-- rule:skill-finish-separate-reviewer -->
