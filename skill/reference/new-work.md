# New visual work

Use this flow when making a new surface or replacing a visual identity. PRODUCT.md owns product truth. DESIGN.md owns durable visual decisions. A surface brief keeps strategy that belongs only to one route or artifact. Complete [init.md](init.md) first when PRODUCT.md is missing; a missing DESIGN.md does not route back to init.

## 1. Decide what is already true

Read DESIGN.md, representative code, tokens, components, and assets.

- **Redesign:** preserve product truth, content, function, constraints, and explicit brand commitments; replace the old visual world rather than polishing it. The old look is evidence of what the subject is, not authority over what it becomes.
- **Established world:** inherit it. A missing DESIGN.md does not erase a coherent identity already present in code; document that identity instead of inventing a replacement.
- **Incomplete brand:** preserve confirmed assets and recognizable traits, then help the user expand the system for this new surface.
- **No visual authority:** create a new world with the user.

A section, component, feature, or state inside an established surface inherits that surface. Do not turn a local addition into a new identity exercise.

## 2. Ask what will change the work

Ask one round of two or three related questions through the structured question tool when available. Skip settled facts; a precise request may need only a compact confirmation.

- **Persuade:** clarify who must act, what they should believe, and which real proof, content, or assets can earn that belief.
- **Operate:** clarify the task, information, important states, frequency, and constraints.
- **Read:** clarify the reader's question, source material, structure, and wayfinding.
- **Experience:** clarify what leads, how exploration unfolds, and which interaction or transition matters.

Across modes, ask what success looks like, what must remain untouched, and what would make a polished result feel wrong. Do not ask for CSS values or canned aesthetic lanes.

## 3. Choose the right amount of invention

### Extend an existing surface

Inherit its world and composition. Resolve only the new purpose, content, hierarchy, states, interaction, and how the addition joins the surrounding experience. Do not run a concept tournament or change DESIGN.md unless the user approves a durable system change.

### Create a whole surface inside an established world

Keep the visual system fixed. Derive five to seven materially different structures from the content, task, and user behavior, ordered by resonance. For a genuinely open whole page, screen, or flow, run:

`node {{scripts_path}}/concept-seed.mjs --scope surface --mode <mode>`

The script assigns which structure gets built: your top-ranked structure is what every run would ship, and a single ranking is deterministic, so the dice come from outside. Dress its staging challengers in the committed identity and weigh them against your list before building. Never run the script for a local extension or a precisely specified narrow request; shape those directly.

### Create or replace the visual world

1. Name the product's unique mechanism in one sentence, the audience's real scene, its cultural home, and what this first surface must prove. Note the page this category always ships and its predictable opposite; name both as the rut and keep them out of the seven-candidate list, so no die face is spent on the page the category already ships.
2. From that cultural world, list seven concrete visual systems, artifacts, places, or rituals the audience knows by heart, each with one line on why it resonates and can carry the mechanism, ordered by resonance. What would this thing look like as a physical object; what did its world look like before the web? Near-duplicates count once, and a list confined to one material or medium family is not divergent.
3. Turn that material into complete directions: each joins a reusable visual world to a concrete first-surface experience.
4. Run `node {{scripts_path}}/concept-seed.mjs --scope direction --mode <mode>` and follow what it prints. The script assigns which direction gets built and deals catalog challengers. Fuse each challenger before judging it: the challenger supplies the form and its system grammar, the product supplies every fact, and clarity wins conflicts. Weigh fused challengers against the assigned direction on exactly two axes, audience identification and product clarity; losing to strong grounded material is a valid outcome, and beating a thin or tool-monoculture list is the point. <!-- rule:skill-concept-procedure -->
5. Present one direction, fully committed: its world, first viewport, visitor path, signature interaction, cross-surface reach, and honest risk. Offer re-roll with an optional one-line steer instead of a ranked menu; a lineup invites the safest card. Re-roll eliminates every direction already shown, grounded and challenger alike; after two consecutive re-rolls, ask what quality is missing. You may re-roll on your own only on named factual grounds, when the assigned direction cannot carry the product's truth or task; taste is never grounds. The user may re-roll freely, and a user- or brief-pinned direction beats the roll, always. <!-- rule:skill-assigned-plus-reroll -->

Catalog worlds are working systems, not mood references. When one survives, carry its palette and material, type and composition, topology, controls and state, and responsive rules into the product. When the source is itself an interface language, commit to its native grammar across navigation, content, controls, and states.

Every direction the roll can land on must already be viable: every relationship and claim it visualizes true, a real palette and component family, a distinctive composition with one product-specific experience, workable at full-surface scale within the available assets, tools, and performance budget. A candidate that fails on truth is replaced before the roll, never rescued by it.

For **Persuade**, the opening must make the offer intelligible and desirable, expose a clear action, and demonstrate something only this product can prove. For **Operate**, expression may never obscure the task, state, or familiar affordance. For **Read**, comprehension and wayfinding remain intact. For **Experience**, the work itself leads from the first viewport.

## 4. Commit the world

Pick a color strategy before picking colors: Restrained (neutrals plus one accent; the default when the visitor came to operate or read), Committed (one saturated color carries 30-60% of the surface), Full palette (3-4 named roles), or Drenched (the surface IS the color). Persuade and Experience surfaces have permission for the bolder strategies; take them when the brief allows. Color commits at page scale: fields that own whole regions, not accents scattered over a neutral ground. Dark or light is never a default: write one sentence of physical scene (who uses this, where, under what light) and let it force the answer. <!-- rule:skill-color-strategy -->

Choose faces like objects from the subject's world, in the mode's register. Operate and Read surfaces are well served by system stacks and workhorse UI faces; Persuade and Experience surfaces want faces with a point of view, and these training-data defaults mean you stopped looking: Fraunces, Playfair Display, Cormorant, Lora, Crimson, Newsreader, Syne, Space Grotesk, Space Mono, IBM Plex, Inter-as-display, DM Sans, DM Serif, Outfit, Plus Jakarta Sans, Instrument Sans. <!-- rule:skill-typo-reflex-faces -->

Calibration: AI-generated interfaces cluster around a few looks regardless of subject: warm cream ground, high-contrast serif display, and a terracotta or signal-red accent; near-black with one neon accent and glowing edges; broadsheet-editorial hairlines, italic display serif, and small tracked mono labels. All are legitimate when the brief calls for them; the brief always wins. Where the brief leaves the aesthetic free, landing in one of them means the self-check failed: if someone could guess your aesthetic from the category alone, or from category-plus-avoidance, rework until neither answer is obvious. <!-- rule:skill-calibration-saturated-looks -->

## 5. Record the decision

Before code, state the chosen direction as a contract in the artifact's opening comment, five short blocks, 150 words at most. THESIS: the one idea this surface owns and the category-default arrangement it refuses. OWN-WORLD: the palette and component language, specific enough to be recognizable with all content removed. STORY: what the visitor understands, believes, and does. FIRST VIEWPORT: the exact composition, what is where and at what scale. FORM: the chosen form, its position on your ordered list, and the seed key the script printed. If a block reads like a mood, the direction is not decided yet; the finishing review audits the render against this contract. <!-- rule:skill-decide-then-build -->

When a new or replacement world is chosen, write DESIGN.md at the appropriate project or app boundary using [document.md](document.md). Record only durable system rules; exact tokens may remain provisional until the first build establishes them. An ordinary extension does not rewrite DESIGN.md.

If the work establishes durable strategy for a route or artifact, read its existing surface brief, then update it:

`node {{scripts_path}}/surface-brief.mjs read <primary-target>`

`node {{scripts_path}}/surface-brief.mjs write <primary-target> <body-file> [related-target ...]`

Keep the brief small: scope and visitor mode; audience, job, action/task, proof/content, and constraints; chosen direction and memorable moment; unresolved decisions. Do not copy global product truth or DESIGN.md tokens into it.

When native image generation is available and words are not enough to judge the choice, use [codex.md](codex.md) to mock the direction before committing. The mock is a selection aid, not authority.

For `shape`, return the selected direction to [shape.md](shape.md) and stop before persistence or implementation.

## 6. Build with full commitment

Build the assigned direction, not a safer interpretation of it. The form supplies structure, reading order, component conventions, and native motion; the product supplies every fact. Commit every atom: nav, buttons, inputs, and links are rebuilt in the form's vocabulary, and a stock component inside a committed form is a lapse. Land the first build fully committed; committing is the hard part, and the passes that follow exist to make the committed thing clear and effective, never to dilute it. In unattended work, the safe rendition is the known risk. <!-- rule:skill-commit-every-atom -->

- **The first viewport is a thesis, not a header.** Demonstrate the mechanism immediately, at the scale the form has in life; do not trap the concept inside a standard hero or card shell. The memory test: if someone left after one viewport, what would they describe an hour later? If the honest answer is a mood, the concept has not committed yet.
- **Prove, don't claim.** Show the subject doing its job: the interface at work, the mechanism dramatized, specifics a competitor could not copy-paste. Sections that restate a claim in different words add length, not substance.
- **Pace the scroll like a studio.** Vary density, scale, image, motion, and quiet inside one grammar; a dense passage earns a quiet one, and the page ends anchored by a real close. One spacing rhythm throughout, with more space above a heading than below it.
- **Use real, verified imagery when the brief implies it.** Search for the subject's physical object rather than the category; one decisive photo beats five mediocre ones. Verify stock URLs resolve.
- **Author motion as material.** The form has native motion, what it does in life between states; give the page that motion once, orchestrated, rather than scattered hover effects. Bound expensive effects and keep content visible by default.

Preserve semantics, accessibility, performance, responsiveness, project conventions, and working behavior.

## 7. Inspect and finish

Inspect desktop and mobile, critique the render against the user's request, the direction contract, and DESIGN.md, fix material gaps, and re-inspect. After a first implementation of a new world, update DESIGN.md with the exact tokens and behaviors that survived the build.

When the harness can run a separate agent, this review belongs there, not in the build thread: give it the original request, confirmed answers, the artifact path, its direction contract, DESIGN.md, and existing hook findings. Ask for a short list of material fixes, promise by promise against the contract, apply them, and finish. Do not run a second detector. <!-- rule:skill-finish-separate-reviewer -->
