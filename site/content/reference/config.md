---
title: Config and ignores
tagline: "Project settings for detector exceptions, hook behavior, and local overrides."
description: "Use .impeccable config for confirmed detector exceptions and runtime settings. Keep product and design intent in PRODUCT.md and DESIGN.md."
section: concepts
order: 2
---

Impeccable stores runtime settings under `.impeccable/`. Most users do not need to hand-edit those files. Use the CLI when you want to record a confirmed exception.

Use config for:

- detector ignores shared by `npx impeccable detect` and the design hook;
- private local ignores that should not be committed;
- hook lifecycle settings such as enabled, quiet mode, and audit logging.

Use `PRODUCT.md` and `DESIGN.md` for product and design intent. See [Design Context](/docs/context).

## The usual path

List the current ignores:

```bash
npx impeccable ignores list
```

Add the narrowest exception that matches the real reason:

```bash
npx impeccable ignores add-value design-system-color "#ff00aa" --reason "Campaign accent"
npx impeccable ignores add-file "src/legacy/**"
npx impeccable ignores add-rule side-tab
```

Remove an exception when the underlying code is fixed:

```bash
npx impeccable ignores remove-value design-system-color "#ff00aa"
```

The same detector config is used by the CLI and the hook, so an ignore behaves consistently in both places.

## Shared or local

Default ignores go into `.impeccable/config.json`. Commit them when they represent team intent: a legacy folder, a confirmed brand exception, or a project-wide rule decision.

Use `--local` for private work:

```bash
npx impeccable ignores add-file "src/private-experiment/**" --local
```

Local settings go into `.impeccable/config.local.json`, which Impeccable keeps out of git.

## Value ignores

Prefer value ignores when a rule reports a specific value:

```bash
npx impeccable ignores add-value overused-font Inter --reason "Brand font"
```

Fonts, colors, radii, and motion values should usually be suppressed by value, not by whole rule. That keeps the rule useful everywhere else.

Wildcard value ignores are allowed only when scoped to a file:

```bash
npx impeccable ignores add-value design-system-color "*" --file "src/demo.css"
```

That keeps one intentionally experimental file from teaching the whole project that every undocumented color is acceptable.

## Inline ignore comments

Config ignores live in `.impeccable/config.json`, which is the right home for repo-wide policy. They do not follow a file out of the repo, though. When a waiver belongs to one file and needs to travel with it (a generated or exported standalone document, an emailed HTML file, a snippet scanned out of context), put the waiver in the file itself:

```html
<!-- impeccable-disable overused-font: exported brand doc, font is first-party -->
```

The directive is comment-syntax-agnostic, so the same marker works in `//`, `/* */`, `<!-- -->`, `#`, and `{/* */}` comments across HTML, CSS, JSX, TSX, Vue, and Svelte. Three scopes are available:

```css
/* impeccable-disable overused-font */            /* whole file */
.brand { font-family: Inter }  /* impeccable-disable-line overused-font */
/* impeccable-disable-next-line bounce-easing */
```

List one or more rule ids, comma-separated, or omit them (or use `*`) for every rule. A reason after `:` or `--` is optional and recommended; it is for the diff, and the scanner discards it. Like config ignores, a matched directive suppresses the finding.

Static HTML findings have no line number, so only whole-file `impeccable-disable` applies to them. That is the standalone-document case this exists for. The line-scoped forms apply to CSS, JSX, TSX, Vue, and Svelte, where findings carry a line.

Inline directives apply by default. `--no-inline-ignores` turns them off for one run while keeping config ignores; `--no-config` turns off config and inline ignores together.

## Details when the default path is not enough

<details class="docs-prose-details">
  <summary>What the config file looks like</summary>
  <div>
    <p>The shared config lives at <code>.impeccable/config.json</code>. A typical file looks like this:</p>
    <pre><code>{
  "detector": {
    "ignoreRules": [],
    "ignoreFiles": [],
    "ignoreValues": [],
    "designSystem": {
      "enabled": true
    }
  },
  "hook": {
    "enabled": true,
    "quiet": false,
    "auditLog": ".impeccable/hook.ndjson"
  }
}</code></pre>
    <p>The <code>detector</code> section is shared by manual scans and hooks. The <code>hook</code> section only controls automatic hook execution and hook output.</p>
  </div>
</details>

<details class="docs-prose-details">
  <summary>Disable design-system checks</summary>
  <div>
    <p>Design-aware rules run when <code>DESIGN.md</code> exists. Disable them for the project only when the design file is intentionally not authoritative yet:</p>
    <pre><code>{
  "detector": {
    "designSystem": {
      "enabled": false
    }
  }
}</code></pre>
    <p>For one manual run, keep config but skip the design-system rules:</p>
    <pre><code>npx impeccable detect --no-design-system src/</code></pre>
    <p>Use <code>--no-config</code> only when you want a raw scan with no project ignores and no <code>DESIGN.md</code> context.</p>
  </div>
</details>

<details class="docs-prose-details">
  <summary>Hook runtime settings</summary>
  <div>
    <p>Use <code>/impeccable hooks</code> for normal lifecycle changes:</p>
    <pre><code>/impeccable hooks status
/impeccable hooks on
/impeccable hooks off</code></pre>
    <p><code>hook.quiet: true</code> suppresses clean and pending acknowledgements while still surfacing new findings.</p>
    <p><code>hook.auditLog</code> writes one NDJSON line per hook invocation for debugging. Leave it off during normal work.</p>
    <p>Environment variables still override config for one shell: <code>IMPECCABLE_HOOK_DISABLED</code>, <code>IMPECCABLE_HOOK_QUIET</code>, and <code>IMPECCABLE_HOOK_LOG</code>.</p>
  </div>
</details>
