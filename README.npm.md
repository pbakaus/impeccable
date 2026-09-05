# Impeccable CLI

Detect UI anti-patterns and design quality issues from the command line, and install the Impeccable design skill into your AI coding harness. The detector scans HTML, CSS, JSX, TSX, Vue, and Svelte files for 61 deterministic rules, including AI-generated UI tells, accessibility violations, and general design quality problems.

The npm package is a small launcher. It runs the `impeccable` engine binary for your platform, installed alongside it as an optional dependency (`@impeccable/cli-<os>-<arch>`), and falls back to a per-user cache or a one-time download when that package is missing.

## Quick Start

```bash
# Install skills into your AI harness (Claude, Cursor, Gemini, etc.)
npx impeccable install

# Non-interactive install for a specific scope
npx impeccable install -y --providers=claude,codex --scope=project

# First command to run inside your AI harness
/impeccable init

# Update skills to the latest version
npx impeccable update

# Install or update skills without hook manifests
npx impeccable install --no-hooks

# Link skills from a Git submodule checkout
npx impeccable link --source=.impeccable --providers=claude,cursor

# List all available commands
npx impeccable help

# Scan files or directories for anti-patterns
npx impeccable detect src/

# Scan a live URL (uses an installed Chrome, Chromium, or Edge)
npx impeccable detect https://example.com

# JSON output for CI/tooling
npx impeccable detect --json src/
```

`npx impeccable skills <command>` is the legacy namespace and still works.

## What It Detects

**AI Slop Tells**: patterns that scream "AI generated this":
- Side-tab accent borders, gradient text on headings
- Purple/violet gradients and cyan-on-dark palettes
- Dark mode with glowing accents, border + border-radius clashes

**Typography Issues**: overused fonts (Inter, Roboto), flat type hierarchy, single font families

**Color & Contrast**: WCAG AA violations, gray text on colored backgrounds, pure black/white

**Layout & Composition**: nested cards, monotonous spacing, everything-centered layouts

**Motion**: bounce/elastic easing, layout property transitions

**Quality**: tiny body text, cramped padding, long line lengths, small touch targets

61 deterministic detector rules in total. See the full catalog at [impeccable.style/slop](https://impeccable.style/slop).

## Exit Codes

- `0`: scan completed with no primary findings (advisories may still be listed)
- `1`: at least one requested target could not be scanned
- `2`: scan completed with primary findings

Operational failure takes precedence when a multi-target scan is partial. In JSON mode, stdout remains a findings array and diagnostics are written to stderr.

## Options

```
impeccable detect [options] [file-or-dir-or-url...]

  --json      Output findings as JSON
  --scope     Only report rules in a design domain (type, layout)
  --help      Show help
```

## Requirements

- Node.js 22.18+ to run `npx impeccable`. The engine itself is a self-contained binary and needs no runtime; the skill installed into your harness calls it directly.
- For URL scans, an installed Chrome, Chromium, or Edge (set `IMPECCABLE_BROWSER` to point at one).

Binary lookup order: `IMPECCABLE_BIN`, the platform package, `~/.impeccable/bin/<version>/`, then a download of the pinned version into that cache. Set `IMPECCABLE_BIN` to a local build to skip all of that.

## Part of Impeccable

This CLI is part of [Impeccable](https://impeccable.style), a cross-provider design skill pack for AI-powered development tools. The full suite includes 24 commands for Claude, Cursor, GitHub Copilot, Gemini, Codex, Hermes Agent, Veto, and more.

## License

[Apache 2.0](https://github.com/pbakaus/impeccable/blob/main/LICENSE)
