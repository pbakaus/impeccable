# Svelte Live Adapter

Svelte/SvelteKit live mode uses temporary component previews instead of editing the route source during generation. Load this file when any live helper output includes:

- `adapter: "sveltekit"`
- `previewMode: "svelte-component"`
- `guidanceRefs` containing `reference/live-svelte.md`

## Core Contract

For `previewMode: "svelte-component"`, the helper output's `file` is a temporary manifest at `node_modules/.impeccable-live/<id>/manifest.json`, not the route source. Write variants only under `componentDir` while generating. Do not edit `sourceFile` until Accept; `live-accept.mjs` handles source promotion.

Use the helper output as source of truth:

- `componentDir`: directory for `v1.svelte`, `v2.svelte`, and so on.
- `sourceFile`: real `.svelte` file that will receive the accepted variant.
- `propContract`: dynamic Svelte expressions extracted from the original selection.
- `cssAuthoring`: exact per-run styling requirements and forbidden patterns.

## Replace Mode

Write one real Svelte component per variant: `componentDir/v1.svelte`, `componentDir/v2.svelte`, etc.

- Keep a single visible top-level root matching the selected element's role and structure.
- Preserve `propContract`: use `{propName}` in component markup instead of literal snapshot text when the contract provides a binding.
- For mixed dynamic/static text such as `{count} offen`, keep the static text literal and replace only the dynamic segment with its prop, e.g. `{count} offen`. If the user asks for stronger text treatment, wrap or class the visible text so typography changes apply to the text itself, not only to the outer pill/card box.
- Put variant CSS in that component's `<style>` block using semantic classes.
- Make every variant visually distinct from the original and from each other. Do not ship variants that differ only by inert attributes, hidden params, or class names without CSS that changes the rendered result.
- Prefer meaningful semantic class hooks for each visual direction; do not rely on generic `data-variant` attributes as the only selector difference.
- Do not add `data-impeccable-*` attributes.
- Do not use `@scope` or `data-impeccable-variant` selectors.
- Reply done with `--file` set to the manifest path returned by the helper.

The browser dynamically imports and mounts these components, which avoids Svelte HMR resetting page state while the user cycles variants.

## Insert Mode

For insert mode, each `vN.svelte` is net-new content mounted before or after the live anchor.

- The component must contain visible inserted content.
- Each insert variant must render a visibly different inserted result, not just the same placeholder with a different class or param manifest.
- Use a single top-level root.
- Do not copy the anchor unless the design actually needs it.
- Do not edit the route source during generation.
- Do not add `data-impeccable-*` preview attributes.

On Accept, `live-accept.mjs` inserts the selected component markup into `sourceFile` at the recorded insert line.

## Params

Svelte component previews must declare params in a sidecar file, never in `data-impeccable-params`. Svelte parses `{` inside attribute values as an expression, so JSON in an attribute can fail compilation.

Write `componentDir/params.json`, keyed by variant number, using the same param schema from `live.md`:

```json
{
  "1": [
    {"id":"density","kind":"steps","default":"snug","label":"Density","options":[
      {"value":"airy","label":"Airy"},{"value":"snug","label":"Snug"},{"value":"packed","label":"Packed"}
    ]}
  ],
  "2": [
    {"id":"accent","kind":"range","min":0,"max":1,"step":0.05,"default":0.5,"label":"Accent"}
  ]
}
```

Author param-driven CSS against `var(--p-<id>, default)` for `range` / `toggle` and `[data-p-<id>="..."]` for `steps`. Wrap those selectors in `:global(...)` when needed so runtime knob values set on the mounted root reach the rules.

## Accept And Discard

Accept inlines the selected component back into `sourceFile`, restores original Svelte expressions from `propContract`, appends accepted CSS to the route component's `<style>` block, bakes chosen params, and deletes the temp component session after source write succeeds.

Discard deletes the temp preview session and leaves `sourceFile` unchanged.

## Common Mistakes

- Do not edit the route source during generation.
- Do not put params in `data-impeccable-params`.
- Do not copy `data-impeccable-*` attributes into component files.
- Do not use `@scope` in component CSS.
- Do not replace dynamic Svelte expressions with literal browser text when `propContract` provides bindings.
