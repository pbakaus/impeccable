# Codex: Surface Probes & Asset Production

Load this from [new-work.md](new-work.md) only when the harness has native image generation and a substantial, high-fidelity surface would benefit from seeing the shortlisted concept before code. PRODUCT.md and DESIGN.md are preconditions. Init has already established the visual world; this file must not reopen it.

The purpose of a probe is to test composition, narrative, hierarchy, density, focal moment, signature use, and image requirements. It is not a second identity workshop. Keep DESIGN.md's palette, typography direction, material language, component character, imagery stance, and motion grammar fixed.

## Generate the smallest useful probe set

Generate one to three high-fidelity north-star comps using the native image-generation capability. Base them on the real content and the surface concepts already developed with the user.

- When the user shortlisted multiple concepts, show one clear expression of each.
- When one concept is already selected, vary only the structural uncertainty that the image can resolve: topology, sequence, density, hierarchy, focal composition, or interaction framing.
- Show enough beyond the opening moment to prove the concept can govern the whole requested surface.
- Do not generate a palette artifact, ask new atmosphere questions, introduce a different type voice, or invent a new motif. If the committed world cannot support the concept, return to the concept shortlist rather than changing the world.

Treat each comp as a direction test, not a screenshot specification. Core UI text, responsive behavior, accessibility, semantics, and interaction states remain implementation responsibilities.

## One approval point

Show the probes together and ask what should carry forward, what feels false to the world, and whether the selected surface concept should be approved, combined, revised, or rejected. Then stop and wait. A structured simulated user counts as attended and receives the same question.

Do not begin code until the user approves a direction or explicitly delegates the choice. If they delegate, choose using the task brief, PRODUCT.md, and DESIGN.md, and state the evidence. Approval refines the task concept; it does not modify DESIGN.md.

After approval, summarize the composition and the parts of the comp that must not be literalized. Return to new-work.md and write the direction contract from the approved surface concept before code.

## Inventory implementation fidelity

Before building, inventory the approved comp's major visible ingredients and choose an implementation medium for each: semantic HTML/CSS/SVG, existing project asset, generated raster, sourced raster, icon library, canvas/WebGL, or accepted omission.

Pay special attention to the dominant composition, signature use, image-native content, second-fold system, and any interaction the still image only implies. If the concept depends on a photograph, architectural scene, product object, portrait, or other raster-native material, do not silently replace it with generic CSS scenery.

Treat the comp as a north star, not something to trace. Do not rasterize core UI text or controls. Do not substitute a different visual driver after approval without asking.

## Produce only the assets the build needs

When clean raster ingredients are required and a scoped subagent is available and authorized, use `impeccable_asset_producer`. Give it the approved comp, output paths, required dimensions and formats, transparency needs, crop notes, and what must remain semantic code. Otherwise produce the minimum required assets with the native image-generation capability in the current thread.

Return to [new-work.md](new-work.md) for the direction contract, implementation, and finishing pass.
