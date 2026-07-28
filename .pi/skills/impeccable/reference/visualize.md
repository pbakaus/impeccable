# Visualize: Direction Comps & Asset Production

Load this from [new-work.md](new-work.md) whenever any image generation is available, a harness-native tool or the API fallback context.mjs reports. PRODUCT.md and DESIGN.md are preconditions. New-work has already resolved the visual world; this file must not reopen it.

The purpose of a probe is to test composition, narrative, hierarchy, density, focal moment, signature use, and image requirements. It is not a second identity workshop. Keep DESIGN.md's palette, typography direction, material language, component character, imagery stance, and motion grammar fixed.

## Generate three compositional options

Render three distinct high-fidelity north-star comps of the requested surface, with whatever generation capability exists, saved under `.impeccable/mocks/` so they survive the session; record the approved comp's path in the surface brief. Open every image you produce or reference by its workspace-relative path, never an absolute one: sandboxed viewers reject absolute paths, and everything under the project root has a relative path. Base them on the real content and the surface concepts already developed with the user. Three is the number: one comp invites rubber-stamping, and the spread between three is what surfaces the composition worth building. A decision-page sketch is not a probe: it chose the direction at deliberately unfinished fidelity, so the three comps render regardless, and the chosen card's sketch seeds at most one of them.

- When the user shortlisted multiple concepts, spread the three across them.
- When one direction is committed, vary the structural uncertainty an image can resolve: topology, sequence, density, hierarchy, focal composition, or interaction framing.
- Show enough beyond the opening moment to prove the concept can govern the whole requested surface.
- Do not generate a palette artifact, ask new atmosphere questions, introduce a different type voice, or invent a new motif. If the committed world cannot support the concept, return to the concept shortlist rather than changing the world.

Treat each comp as a direction test, not a screenshot specification. Core UI text, responsive behavior, accessibility, semantics, and interaction states remain implementation responsibilities.

## One approval point

Show the three together: in the harness when it can display images, otherwise on the decision page (`serve-question.mjs`, one option per comp with the comp as its hero). Ask what should carry forward, what feels false to the world, and whether the selected surface concept should be approved, combined, revised, or rejected. Then stop and wait. A structured simulated user counts as attended and receives the same question.

Do not begin code until the user approves a direction or explicitly delegates the choice. If they delegate, choose using the task brief, PRODUCT.md, and DESIGN.md, and state the evidence. Approval refines the task concept; it does not modify DESIGN.md.

After approval, summarize the composition and the parts of the comp that must not be literalized. Return to new-work.md, record the direction contract from the approved surface concept, then build.

## Inventory implementation fidelity

Before building, inventory the approved comp's major visible ingredients in writing (a short table in the surface brief or working notes; the finish reviewer audits shipped assets against it) and choose an implementation medium for each: semantic HTML/CSS/SVG, existing project asset, generated raster, sourced raster, icon library, canvas/WebGL, or accepted omission. The same written inventory names the comp's compositional commitments: navigation items and icons, headline levels and their scale relationship, signature geometry such as seams, masks, and overlaps, and each section's arrangement and density. An element never written down is the element the build silently drops, and the direction contract's 150 words cannot carry this list, so this inventory is where it lives. Textures, portraits, and scenes are raster-by-default; a CSS gradient is not a texture medium. Every `produce` entry is produced before the build ships, through the asset producer or in the current thread; an inventory with unproduced entries is an unfinished build, and this gate is where imagery-free pages come from when it is skipped.

Pay special attention to the dominant composition, signature use, image-native content, second-fold system, and any interaction the still image only implies. If the concept depends on a photograph, architectural scene, product object, portrait, or other raster-native material, do not silently replace it with generic CSS scenery.

Treat the comp as a north star, not something to trace, and know what that allows: translation into semantic, responsive, accessible code, never recomposition. Keeping the palette and mood while redrawing the topology is a second art direction, not an adaptation. Do not rasterize core UI text or controls. Do not substitute a different visual driver after approval without asking.

## Produce only the assets the build needs

When clean raster ingredients are required and the harness runs subagents, use the shipped asset producer, `impeccable-asset-producer` (`impeccable_asset_producer` in codex): give it the approved comp, output paths, required dimensions and formats, transparency needs, crop notes, and what must remain semantic code. Otherwise produce the minimum required assets in the current thread by the book: load [degraded/asset-producer.md](degraded/asset-producer.md) and follow it inline, with whatever generation exists, the native tool or generate-image.mjs.

Return to [new-work.md](new-work.md) for the direction contract, implementation, and the finishing pass.
