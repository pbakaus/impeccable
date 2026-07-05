---
title: Detector CLI
tagline: "Run Impeccable's deterministic design checks without an AI harness."
description: "Use npx impeccable detect on files, directories, stdin, and URLs; understand findings, exit codes, ignores, and design-system-aware checks."
section: automation
order: 1
---

`npx impeccable detect` runs Impeccable's deterministic design checks directly from the terminal. Use it when you want a fast signal without asking an AI command to review the work.

## Fast path

Scan the source folder:

```bash
npx impeccable detect src/
```

Scan one file:

```bash
npx impeccable detect src/components/Card.tsx
```

Scan a rendered page:

```bash
npx impeccable detect https://example.com
```

Use JSON when another script or CI job needs to read the result:

```bash
npx impeccable detect --json src/
```

## What it checks

The detector looks for design and implementation patterns that are usually visible to users: contrast problems, typography drift, layout overflow, generic AI-design tells, brittle motion, and design-system violations when `DESIGN.md` exists.

Directories are walked for design-relevant files. HTML files include linked local CSS. Framework files such as JSX, TSX, Vue, Svelte, Astro, and CSS modules get source-text checks. URL targets use a browser and inspect the rendered page.

## How to read results

Plain output groups findings by file and prints the rule id, snippet, and explanation. Exit codes are:

| Code | Meaning |
|---|---|
| `0` | No findings. |
| `2` | Findings were detected. |
| `1` | The command failed. |

That makes CI usage straightforward: fail the job on `2`, then decide whether to fix the issue or add a narrow ignore.

## DESIGN.md awareness

When a local `DESIGN.md` exists, `detect` loads it by default and enables design-system checks for fonts, literal colors, border radii, and literal font sizes documented in the typography ramp. The generated `.impeccable/design.json` sidecar gives those checks richer token and ramp data.

If the design file is stale, refresh it:

```text
/impeccable document
```

If you need one scan without design-system checks:

```bash
npx impeccable detect --no-design-system src/
```

To narrow a scan to one design domain (for example before a typeset or layout pass):

```bash
npx impeccable detect --scope type src/
npx impeccable detect --scope layout src/
```

## Managing intentional findings

Detector ignores are shared with the design hook:

```bash
npx impeccable ignores list
npx impeccable ignores add-value overused-font Inter --reason "Brand font"
npx impeccable ignores add-file "src/legacy/**"
```

For a waiver that should travel with one file instead of living in the repo config, drop an inline comment in the file itself:

```html
<!-- impeccable-disable overused-font: exported brand doc -->
```

Use [Config and ignores](/docs/config) for the full ignore workflow, including the line-scoped `impeccable-disable-line` and `impeccable-disable-next-line` forms.

## Details when the default path is not enough

<details class="docs-prose-details">
  <summary>Scan stdin</summary>
  <div>
    <p>If you pipe text into the command with no target, it scans stdin:</p>
    <pre><code>cat component.css | npx impeccable detect</code></pre>
  </div>
</details>

<details class="docs-prose-details">
  <summary>Project config and raw scans</summary>
  <div>
    <p>By default, <code>detect</code> reads <code>.impeccable/config.json</code> and <code>.impeccable/config.local.json</code>.</p>
    <p>It respects <code>detector.ignoreRules</code>, <code>detector.ignoreFiles</code>, <code>detector.ignoreValues</code>, and <code>detector.designSystem.enabled</code>.</p>
    <p>It does not respect <code>hook.enabled</code>; manual scans still run when the automatic hook is disabled.</p>
    <p>In-file <code>impeccable-disable*</code> comments are honored too, so a waiver can travel with a file. <code>--no-inline-ignores</code> skips just those; <code>--no-config</code> skips config and inline ignores together.</p>
    <p>Use <code>--no-config</code> only when you want a raw detector run with no project config, no detector ignores, and no <code>DESIGN.md</code> context.</p>
  </div>
</details>

<details class="docs-prose-details">
  <summary>Provider-specific checks</summary>
  <div>
    <p>Some rules are provider-specific and opt in:</p>
    <pre><code>npx impeccable detect --gpt src/
npx impeccable detect --gemini src/</code></pre>
    <p>Leave them off for normal project quality checks. Turn them on when you specifically want to catch model-family fingerprints.</p>
  </div>
</details>

<details class="docs-prose-details">
  <summary>Where the detector fits</summary>
  <div>
    <p>The same detector also powers the design hook, <code>/impeccable audit</code>, the public <a href="/slop">slop catalog</a>, the browser extension, and the local detector lab.</p>
    <p>Use <a href="/docs/hooks">Design hooks</a> when you want findings inside the agent flow. Use <code>detect</code> when you want a direct terminal signal.</p>
  </div>
</details>
