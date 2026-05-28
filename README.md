# Impeccable

Design guidance for AI coding agents. 1 skill, 23 commands, live browser iteration, and 41 deterministic detector rules for AI-generated frontend design.

> **Quick start:** From your project root, run `npx impeccable skills install`, then run `/impeccable init` inside your AI coding tool. Full docs: [impeccable.style](https://impeccable.style).

## Why Impeccable?

Anthropic's [frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design) was the first widely-used design skill for Claude. Impeccable started from there.

Every model trained on the same SaaS templates. Skip the guidance and you get the same handful of tells on every project: Inter for everything, purple-to-blue gradients, cards nested in cards, gray text on colored backgrounds, the rounded-square icon tile above every heading.

Impeccable adds:
- **One setup flow.** `/impeccable init` writes `PRODUCT.md` and offers `DESIGN.md`, so later commands know the audience, brand/product lane, voice, anti-references, colors, type, and components.
- **23 commands.** A shared design vocabulary with your AI: `polish`, `audit`, `critique`, `distill`, `animate`, `bolder`, `quieter`, and more.
- **41 deterministic detector rules** plus LLM-only critique checks. The CLI and browser extension run the deterministic rules with no LLM and no API key.

## What's Included

### The Skill: impeccable

The skill installs as one command:

```bash
/impeccable <command> <target>
```

Start every new project with:

```bash
/impeccable init
```

`init` asks whether the surface is brand (marketing, landing, portfolio) or product (app UI, dashboard, tool), then writes project context that every later command reads.

### 23 Commands

All commands are accessed through `/impeccable`:

| Command | What it does |
|---------|--------------|
| `/impeccable craft` | Full shape-then-build flow with visual iteration |
| `/impeccable init` | One-time setup: gather design context, write PRODUCT.md and DESIGN.md, configure live mode, recommend next steps |
| `/impeccable document` | Generate root DESIGN.md from existing project code |
| `/impeccable extract` | Pull reusable components and tokens into the design system |
| `/impeccable shape` | Plan UX/UI before writing code |
| `/impeccable critique` | UX design review: hierarchy, clarity, emotional resonance |
| `/impeccable audit` | Run technical quality checks (a11y, performance, responsive) |
| `/impeccable polish` | Final pass, design system alignment, and shipping readiness |
| `/impeccable bolder` | Amplify boring designs |
| `/impeccable quieter` | Tone down overly bold designs |
| `/impeccable distill` | Strip to essence |
| `/impeccable harden` | Error handling, i18n, text overflow, edge cases |
| `/impeccable onboard` | First-run flows, empty states, activation paths |
| `/impeccable animate` | Add purposeful motion |
| `/impeccable colorize` | Introduce strategic color |
| `/impeccable typeset` | Fix font choices, hierarchy, sizing |
| `/impeccable layout` | Fix layout, spacing, visual rhythm |
| `/impeccable delight` | Add moments of joy |
| `/impeccable overdrive` | Add technically extraordinary effects |
| `/impeccable clarify` | Improve unclear UX copy |
| `/impeccable adapt` | Adapt for different devices |
| `/impeccable optimize` | Performance improvements |
| `/impeccable live` | Visual variant mode: iterate on elements in the browser |

Use `/impeccable pin <command>` to create standalone shortcuts (e.g., `pin audit` creates `/audit`).

#### Usage Examples

```
/impeccable audit blog           # Audit blog hub + post pages
/impeccable critique landing     # UX design review
/impeccable polish settings      # Final pass before shipping
/impeccable harden checkout      # Add error handling + edge cases
```

Or use `/impeccable` directly with a description:
```
/impeccable redo this hero section
```

### Anti-Patterns

The skill includes explicit guidance on what to avoid:

- Don't use overused fonts (Arial, Inter, system defaults)
- Don't use gray text on colored backgrounds
- Don't use pure black/gray (always tint)
- Don't wrap everything in cards or nest cards inside cards
- Don't use bounce/elastic easing (feels dated)

## See It In Action

Visit [impeccable.style](https://impeccable.style#casestudies) to see before/after case studies of real projects transformed with Impeccable commands.

## Installation

### Option 1: CLI installer (Recommended)

From the root of your project, run:

```bash
npx impeccable skills install
```

This auto-detects your harness and writes the build compiled for it to the right location (`.claude/skills/`, `.cursor/skills/`, etc.). Works with Cursor, Claude Code, Gemini CLI, Codex CLI, and every other supported tool. Reload your harness afterward.

Claude Code users can alternatively install the plugin with `/plugin marketplace add pbakaus/impeccable`. The general-purpose `npx skills add pbakaus/impeccable` also works, though it installs one shared build for all harnesses rather than the one compiled for yours.

### Option 2: Git Submodule

For teams that want to keep Impeccable vendored and updated through Git, add this repo as a submodule and link the compiled provider build into your harness folders:

```bash
git submodule add https://github.com/pbakaus/impeccable .impeccable
npx impeccable skills link --source=.impeccable --providers=claude,cursor
git add .gitmodules .impeccable .claude .cursor
git commit -m "Add Impeccable skills"
```

Use the providers your project needs, for example `claude`, `cursor`, `gemini`, `codex`, `github`, `opencode`, `pi`, `qoder`, `trae`, `trae-cn`, or `rovo-dev`. The command links individual skill folders from `.impeccable/dist/universal/` and leaves existing real skill directories untouched unless you pass `--force`.

To update later:

```bash
git submodule update --remote .impeccable
npx impeccable skills link --source=.impeccable --providers=claude,cursor
```

### Option 3: Download from Website

Visit [impeccable.style](https://impeccable.style), download the ZIP for your tool, and extract to your project.

### Option 4: Copy from Repository

**Cursor:**
```bash
cp -r dist/cursor/.cursor your-project/
```

> **Note:** Cursor skills require setup:
> 1. Switch to Nightly channel in Cursor Settings → Beta
> 2. Enable Agent Skills in Cursor Settings → Rules
>
> [Learn more about Cursor skills](https://cursor.com/docs/context/skills)

**Claude Code:**
```bash
# Project-specific
cp -r dist/claude-code/.claude your-project/

# Or global (applies to all projects)
cp -r dist/claude-code/.claude/* ~/.claude/
```

**OpenCode:**
```bash
cp -r dist/opencode/.opencode your-project/
```

**Pi:**
```bash
cp -r dist/pi/.pi your-project/
```

**Gemini CLI:**
```bash
cp -r dist/gemini/.gemini your-project/
```

> **Note:** Gemini CLI skills require setup:
> 1. Install preview version: `npm i -g @google/gemini-cli@preview`
> 2. Run `/settings` and enable "Skills"
> 3. Run `/skills list` to verify installation
>
> [Learn more about Gemini CLI skills](https://geminicli.com/docs/cli/skills/)

**Codex CLI:**
```bash
# Project-local
cp -r dist/agents/.agents your-project/

# Or user-wide
mkdir -p ~/.agents/skills
cp -r dist/agents/.agents/skills/* ~/.agents/skills/
```

> The asset-producer subagent ships nested inside the skill's own `agents/` folder, which Codex auto-discovers. No separate `.codex/agents/` copy is needed.

**GitHub Copilot:**
```bash
cp -r dist/github/.github your-project/
```

**Trae:**
```bash
# Trae China (domestic version)
cp -r dist/trae/.trae-cn/skills/* ~/.trae-cn/skills/

# Trae International
cp -r dist/trae/.trae/skills/* ~/.trae/skills/
```

> **Note:** Trae has two versions with different config directories:
> - **Trae China**: `~/.trae-cn/skills/`
> - **Trae International**: `~/.trae/skills/`
>
> After copying, restart Trae IDE to activate the skills.

**Rovo Dev:**
```bash
# Project-specific
cp -r dist/rovo-dev/.rovodev your-project/

# Or global (applies to all projects)
cp -r dist/rovo-dev/.rovodev/skills/* ~/.rovodev/skills/
```

**Qoder:**
```bash
# Project-specific
cp -r dist/qoder/.qoder your-project/

# Or global (applies to all projects)
cp -r dist/qoder/.qoder/skills/* ~/.qoder/skills/
```

## Usage

Once installed, every command runs through the single `/impeccable` skill:

```
/impeccable audit        # Find issues
/impeccable polish       # Final cleanup
/impeccable distill      # Remove complexity
/impeccable critique     # Full design review
```

Type `/impeccable` alone to see the full command list.

Most commands accept an optional argument to focus on a specific area:

```
/impeccable audit the header
/impeccable polish the checkout form
```

If you reach for one command often, pin it with `/impeccable pin audit` to get `/audit` as a standalone shortcut.

**Note:** Codex uses skills here, not `/prompts:` commands. Open `/skills` or type `$impeccable`. Repo-local installs live in `.agents/skills/`; user-wide installs live in `~/.agents/skills/`. GitHub Copilot uses `.github/skills/`. Restart the tool if a newly installed skill does not appear.

## Design hook

On Claude Code and Codex, Impeccable installs two hooks that wrap the design detector around your edits.

**`PostToolUse`** fires after `Edit`, `Write`, `MultiEdit`, or `apply_patch` on UI files. Claude Code sends `tool_input.file_path` on Edit/Write/MultiEdit; Codex `apply_patch` sends the patch in `tool_input.command` (the hook parses `*** Update File:` / `*** Add File:` lines). When you edit a component (`.tsx`, `.jsx`, etc.), the hook also scans static CSS it imports and co-located stylesheets (`styles.css`, `*.module.css`, same basename). Restricted to UI extensions: `.tsx`, `.jsx`, `.html`, `.vue`, `.svelte`, `.astro`, `.css`, `.scss`, `.less`, `.ts`, `.js`. Tool calls with no resolvable path (Bash, `mcp__node_repl__*`, browser tools) are a silent skip.

Every fire that actually scans something emits a developer-role system reminder so the hook stays a conversational presence the model can act on. Three emission states map to three message shapes:

- **Fresh findings**: the imperative `Required design corrections in ...` template, with the directive footer asking the model to fix and acknowledge before finalizing.
- **Pending findings**: the file still has issues we already told the model about in this session but it hasn't fixed yet. Short re-nudge listing the unresolved rules: `Still has N issue(s) flagged earlier this session (side-tab:3, ...). Address them before finalizing.`
- **Truly clean**: detector returned zero. Short positive ack: `No anti-patterns. Keep typography hierarchy, spacing rhythm, and color contrast intentional on the next change.`

Never blocks an edit. Never silent on a successful scan, with one exception: detector crashes stay silent because we don't know the truth. To restore the old silent-on-clean behavior set `IMPECCABLE_HOOK_QUIET=1` in your shell; findings emissions still fire under QUIET, only the pending and clean acks are suppressed.

**`SessionStart`** is the orientation hook. It fires on session startup and resume (not on compact/clear), gated to projects that look like UI code (a known UI dep in `package.json` or a top-level `index.html`) and throttled to once every 30 days per project. It emits a single-line system reminder telling the model the hook is active and how to disable it. Skipped silently everywhere else.

### Installing on Claude Code

`npx skills add impeccable` installs the plugin and both hooks at once. They are on by default.

### Installing on Codex

Codex discovers hooks from registered plugins, not from project-local files, so it needs three commands the first time:

```bash
codex plugin marketplace add https://github.com/pbakaus/impeccable
codex plugin add impeccable@impeccable
# then inside an interactive Codex session:
/hooks   # approve PostToolUse and SessionStart for Plugin · impeccable
```

You can also do the last step via Settings → Hooks and flip the toggles next to `Plugin · impeccable`. Codex tracks trust per `{plugin}@{marketplace}` identity in `~/.codex/config.toml`, so you re-approve from `/hooks` when the plugin updates. The `hooks` and `plugin_hooks` feature flags are stable and on by default in current Codex builds. Codex hooks are disabled on Windows; the skill and commands still work there. The Claude Code hook runs on macOS, Linux, and Windows.

**Disable per project**: run `/impeccable hooks off`. Re-enable with `/impeccable hooks on`. Inspect with `/impeccable hooks status`. The toggle persists in `.impeccable/hook.json`, so check it in if a teammate set it.

**Disable globally**: set `IMPECCABLE_HOOK_DISABLED=1` in your shell. For CI, this is the cleanest path.

**Lower the chat noise without disabling**: set `IMPECCABLE_HOOK_QUIET=1` to suppress the pending and clean acks. Findings emissions still fire (they're the real signal). Use this if the conversational nudges feel like context bloat for your workflow.

**Tune the hook**: `.impeccable/hook.json` supports `ignoreRules` (skip specific findings), `ignoreFiles` (project-relative globs), `minSeverity`, and `limits.maxFindings` / `limits.maxChars`. Inline suppression uses language-aware comments: `// impeccable: ignore <rule>` for JS/TS, `<!-- impeccable: ignore <rule> -->` for HTML/Vue/Svelte/Astro, `{/* impeccable: ignore <rule> */}` for JSX/TSX, `/* impeccable: ignore <rule> */` for CSS. `*` matches every rule. The directive applies to the next non-blank line. Same convention as ESLint, Stylelint, and Biome.

**Debug**: set `IMPECCABLE_HOOK_LOG=$HOME/.impeccable/hook.ndjson` to get one NDJSON line per fire (event, file, findings count, durationMs, skip reason). Off by default.

The hook covers roughly the slop half of the detector ruleset: anything the regex engine catches without needing a rendered DOM. Layout and a11y rules require running the full audit. `/impeccable audit` is the deeper review; the hook is the always-on first line of defense.

## CLI

Impeccable includes a standalone CLI for detecting anti-patterns without an AI harness:

```bash
npx impeccable detect src/                   # scan a directory
npx impeccable detect index.html             # scan an HTML file
npx impeccable detect https://example.com    # scan a URL (Puppeteer)
npx impeccable detect --fast --json .        # regex-only, JSON output
```

The detector catches 41 deterministic issues across AI slop (side-tab borders, purple gradients, bounce easing, dark glows) and general design quality (line length, cramped padding, small touch targets, skipped headings, and more).

## Supported Tools

- [Cursor](https://cursor.com)
- [Claude Code](https://claude.ai/code)
- [OpenCode](https://opencode.ai)
- [Pi](https://pi.dev)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli)
- [Codex CLI](https://github.com/openai/codex)
- [VS Code Copilot](https://code.visualstudio.com)
- [Kiro](https://kiro.dev)
- [Trae](https://trae.ai)
- [Rovo Dev](https://www.atlassian.com/software/rovo)
- [Qoder](https://qoder.com)

## Community & Ecosystem

Join the community and ecosystem conversations:

- GitHub Discussions: file bugs, request features, and help newcomers.
- [Impeccable on npm](https://www.npmjs.com/package/impeccable): grab the CLI, follow releases, and star the package.
- Follow @pbakaus on Twitter for release notes, sample lint reports, and video highlights of new rules.

## Contributing

See [DEVELOP.md](docs/DEVELOP.md) for contributor guidelines and build instructions.

## License

Apache 2.0. See [LICENSE](LICENSE).

---

Created by [Paul Bakaus](https://www.paulbakaus.com)
