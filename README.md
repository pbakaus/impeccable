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

This auto-detects your harness and writes the build compiled for it to the right location (`.claude/skills/`, `.cursor/skills/`, etc.). On Claude Code, Cursor, and Codex, it also installs the provider-native hook manifest. Works with Cursor, Claude Code, Gemini CLI, Codex CLI, and every other supported tool. Reload your harness afterward.

To refresh an existing install, run:

```bash
npx impeccable skills update
```

Codex users should open `/hooks` after install or update and approve the project hook when prompted. Codex tracks trust by hook definition, so updates that change `.codex/hooks.json` can require approval again.

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
mkdir -p your-project/.codex
cp dist/codex/.codex/hooks.json your-project/.codex/hooks.json

# Or install the skill user-wide. Copy .codex/hooks.json into each project
# where you want the design hook to run.
mkdir -p ~/.agents/skills
cp -r dist/agents/.agents/skills/* ~/.agents/skills/
```

> The asset-producer subagent ships nested inside the skill's own `agents/` folder, which Codex auto-discovers. No separate `.codex/agents/` copy is needed. The hook is project-local because Codex discovers hooks from `.codex/hooks.json` next to trusted project config.

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

On Claude Code, Codex, and Cursor, `npx impeccable skills install` and `npx impeccable skills update` install a provider-native hook manifest along with the skill payload. The hook runs the Impeccable design detector on direct UI file edits and surfaces findings back into the agent flow. Claude Code and Codex surface findings after the edit. Cursor blocks bad proposed writes before they land.

Installed hook surfaces:

- Claude Code: `.claude/settings.local.json` (gitignored, machine-local) runs `${CLAUDE_PROJECT_DIR}/.claude/skills/impeccable/scripts/hook.mjs`. A hook moved into the shared `settings.json` is honored in place.
- Cursor: `.cursor/hooks.json` runs `.cursor/skills/impeccable/scripts/hook-before-edit.mjs`.
- Codex: `.codex/hooks.json` runs `.agents/skills/impeccable/scripts/hook.mjs`.

The installer preserves unrelated hook entries and settings. If a hook manifest is malformed, install/update aborts by default; rerun with `--force` to back up the malformed file as `.bak` and replace it.

On an interactive `install`/`update`, Impeccable explains the hook and offers to install it (default yes). Your choice is remembered per-developer in the gitignored `.impeccable/config.local.json`, so you are not asked again; `--no-hooks` skips it for that run without recording anything. Hook settings (enable/ignore rules, etc.) live under the `hook` key of `.impeccable/config.json`, managed with `/impeccable hooks`.

For debugging, set `hook.auditLog` in `.impeccable/config.json` to a path (or the legacy `IMPECCABLE_HOOK_LOG` env var) to write one NDJSON line per hook invocation. Leave it unset for normal use.

Codex requires one platform step that Impeccable cannot safely skip: open `/hooks` after install or update and approve the project hook. There is no Codex marketplace/plugin install flow for this hook.

Manual copy commands are fallback/debug instructions. The normal path is:

```bash
npx impeccable skills install
npx impeccable skills update
```

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
