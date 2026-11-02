# Impeccable

The design vocabulary for your coding agent. Steer with `polish` and `bolder`, review with `critique` and `audit`, and catch AI slop before it ships.

From your project root:

```bash
npx impeccable install
```

Reload your coding tool, then run `/impeccable init` in your agent (`$impeccable init` on Codex).

Works with Claude Code, Cursor, Codex CLI, GitHub Copilot, Devin, Replit Agent, Gemini CLI, Grok Build, OpenCode, Google Antigravity, Kiro, Trae, Rovo Dev, Qoder, Mistral Vibe, Pi, Hermes Agent, DeepSeek Harness, and Veto. Full docs live at [impeccable.style/docs](https://impeccable.style/docs).

| Without Impeccable | With Impeccable |
|---|---|
| ![Villa Castagneto built without Impeccable: cream background, a thin serif headline with an italic accent, two pill buttons, and flat vector illustrations in rounded cards](https://github.com/pbakaus/impeccable/raw/main/docs/images/readme-without.webp) | ![Villa Castagneto built with Impeccable: a full-bleed engraved night scene of the villa on its cliff above the sea, a condensed cream and vermilion headline, and a month strip along the bottom](https://github.com/pbakaus/impeccable/raw/main/docs/images/readme-with.webp) |

Same model (Fable 5.1), same brief: a fourteen-room family guesthouse on the Ligurian coast. Without Impeccable, it builds the tasteful default: cream page, thin serif, italic accent, pill buttons. With it, the page is built around one picture: the house at night, seen from the water.

For a full project, see the [Neo Mirai case study](https://impeccable.style/cases/neo-mirai): a conference site taken from mockup to shipped page.

## Why

Inter for everything. Purple-to-blue gradients. Cards nested in cards, gray text on colored backgrounds, a rounded-square icon tile above every heading. Ask an agent for a page with no other guidance and these show up again and again, across models and projects.

- **Words for what you want.** "Make it pop" leaves your agent to guess. `/impeccable bolder the pricing cards` loads a playbook written for that one move and points it at one target.
- **A reviewer.** `critique` scores the design against usability heuristics and ranks what to fix first. `audit` checks accessibility, performance, theming, and responsive behavior, with findings ranked P0 (blocking) to P3 (polish).
- **A slop detector.** 62 deterministic rules flag the tells above, plus quality problems like cramped padding and skipped headings. No LLM, no API key.

Impeccable is strongest on interfaces that already exist: point it at a page or a component and iterate. It builds new pages too; see [Build something new](https://impeccable.style/docs/new-work) for how to get the most out of that harder mode. To start, pick one component:

```
/impeccable critique the pricing cards
```

## How it works

Run `/impeccable init` once per project. It reads your code, asks only what it can't infer (who the product is for, what it needs to do, the constraints), and writes `PRODUCT.md`. Every later command reads it. Run `/impeccable document` to capture your existing visual system in `DESIGN.md`, so changes stay on-brand. [More on context files](https://impeccable.style/docs/context).

Then name a command and a target:

```
/impeccable critique the onboarding flow
/impeccable quieter the landing page
/impeccable polish settings
/impeccable harden checkout
```

Or just describe what you want: `/impeccable redo this hero section`. Narrow targets get better results; a single section reviewed closely beats a whole page at a glance. Pin a command you use often with `/impeccable pin audit` to get `/audit` as its own shortcut.

### 24 commands

| | Commands |
|---|---|
| **Steer** | `bolder` amplifies safe designs · `quieter` tones down loud ones · `distill` removes what the page doesn't need · `colorize` brings color to a gray interface · `typeset` fixes fonts, hierarchy, and sizing · `layout` fixes spacing and rhythm · `animate` adds transitions and interaction feedback · `delight` adds personality · `overdrive` goes for shaders, spring physics, and scroll-driven effects |
| **Review** | `critique` is a scored UX review · `audit` is a technical quality report |
| **Finish** | `polish` is the final pass before shipping · `harden` covers errors, i18n, overflow, and edge cases · `clarify` rewrites unclear copy · `adapt` handles screen sizes and devices · `optimize` fixes loading and rendering performance · `onboard` designs first-run flows and empty states |
| **Iterate live** | `live` lets you pick an element in the browser and cycle through variants · `generate` produces variants of a named element without manual picking |
| **Plan and set up** | `shape` plans UX before code · `init` writes `PRODUCT.md` · `document` writes `DESIGN.md` · `extract` pulls repeated patterns into your design system |

The 24th, `craft`, is a deprecated alias for a plain build request. Type `/impeccable` alone to see the list in your agent. Each command has its own page: [impeccable.style/docs](https://impeccable.style/docs).

On Codex, open `/skills` or type `$impeccable` instead of the slash command.

### Live mode

`/impeccable live` opens your running dev server with an overlay. Select an element, pick a direction, and Impeccable hot-swaps variants in place. Accept one and it is written back to your source. It works with Vite, Next, SvelteKit, Astro, Nuxt, and plain HTML. [Iterate in the browser](https://impeccable.style/tutorials/iterate-live).

Live mode edits a local checkout only; don't inject it into a deployed site or weaken a production CSP to make it work. Applying copy edits runs your `package.json`'s optional `impeccable:manual-edit-validate` script with your permissions, so review it before using live mode in an unfamiliar repo.

## Three ways to run the detector

**In your agent.** The design hook scans every UI file your agent edits and hands the findings back before the agent calls the work done. This is where most slop gets caught: without the hook, the detector only runs when someone remembers to run it. It's available on Claude Code, Cursor, Codex, GitHub Copilot, Grok Build, and Hermes Agent, and the installer sets it up. Say yes. [Automatic design checks](https://impeccable.style/docs/hooks).

**In CI or your terminal.** The CLI needs no agent:

```bash
npx impeccable detect src/                   # scan a directory
npx impeccable detect https://example.com    # scan a rendered page (uses your installed Chrome or Edge)
npx impeccable detect --json .               # machine-readable output
npx impeccable detect --github src/          # GitHub Actions annotations
npx impeccable detect --list-rules           # every rule with its id and description
```

Source files like JSX and TSX get the pattern rules only. Rules that need a rendered page, such as low contrast and tiny text, run when you scan a URL, so point the CLI at your dev server too: `npx impeccable detect http://localhost:5173`.

Exit code `2` means findings, `1` means a target couldn't be scanned. To allow your brand font everywhere, run `npx impeccable ignores add-value overused-font Inter --reason "Brand font"`. To turn a rule off for one file, add a comment: `<!-- impeccable-disable overused-font: exported brand doc -->`. [Run a detector scan](https://impeccable.style/docs/detector) · [Configuration and ignores](https://impeccable.style/docs/config).

**In your browser.** The [Chrome extension](https://chromewebstore.google.com/detail/impeccable/bdkgmiklpdmaojlpflclinlofgjfpabf) overlays the same findings on any live page, yours or anyone else's. [Review with a visual overlay](https://impeccable.style/tutorials/critique-with-overlay).

## Installation

```bash
npx impeccable install
```

The installer detects your coding tools, asks whether to install for this project or globally, and offers the design hook where your tool supports one. Accept the hook. Reload your tool afterward. `npx impeccable update` refreshes an existing install. For scripts, pass `--providers=claude,codex,cursor` and `--scope=project|global`.

Three tools need one more step before the hook runs. In Codex, open `/hooks` and approve the project hook (again after an update that changes it). In Grok Build, run `/hooks-trust` or launch with `--trust`. In Hermes Agent, the hook is a plugin: run `hermes plugins enable impeccable-design-hook` once. [Allow the hook in your harness](https://impeccable.style/docs/hooks#allow-the-hook-in-your-harness).

Node is only needed for `npx`. The skill itself runs a self-contained engine binary that ships next to it or downloads once into `~/.impeccable/bin/`.

<details>
<summary><b>Claude Code, Copilot, and Grok plugins</b></summary>

**Claude Code:** `/plugin marketplace add pbakaus/impeccable`, then open `/plugin` and install Impeccable.

**GitHub Copilot in VS Code:** install [Impeccable from the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=renaissance-geek.impeccable) or run `code --install-extension renaissance-geek.impeccable`. Needs VS Code 1.109.3+, Copilot Chat, and a trusted workspace. It installs the skill without the hook. [Details](docs/VSCODE-EXTENSION.md).

**Grok Build:** `grok plugin install pbakaus/impeccable#plugin --trust` installs the skill, agents, and hook.

</details>

<details>
<summary><b>Git submodule (a pinned version for the whole team)</b></summary>

```bash
git submodule add https://github.com/pbakaus/impeccable vendor/impeccable
npx impeccable link --source=vendor/impeccable --providers=claude,cursor
```

Commit `.gitmodules`, the submodule, and the generated links. Teammates run `git submodule update --init --recursive`. To upgrade, run `git submodule update --remote vendor/impeccable`, rerun the `link` command, and commit. Linking installs skills, not hooks. Existing skill folders stay put unless you pass `--force`.

</details>

<details>
<summary><b>Manual copy, no Node required</b></summary>

Download the ZIP for your tool from [impeccable.style](https://impeccable.style), or clone this repo: each tool's build is committed at the repo root. Copy `skills/impeccable` from the folder below into the same place in your project, or into the global folder.

| Tool | Repo folder | Global skills folder |
|---|---|---|
| Claude Code | `.claude/` | `~/.claude/skills/` |
| Cursor | `.cursor/` | |
| Codex CLI, Replit Agent | `.agents/` | `~/.agents/skills/` |
| Devin | `.devin/` | `${XDG_CONFIG_HOME:-$HOME/.config}/devin/skills/` |
| GitHub Copilot | `.github/` | |
| Gemini CLI | `.gemini/` | |
| Google Antigravity | `.agent/` | `~/.gemini/config/skills/` |
| OpenCode | `.opencode/` | |
| Grok Build | `.grok/` | `~/.grok/skills/` |
| Hermes Agent | `.hermes/` | `${HERMES_HOME:-$HOME/.hermes}/skills/` |
| DeepSeek Harness | `.dsh/` | `${DSH_HOME:-$HOME/.dsh}/skills/` |
| Pi | `.pi/` | |
| Qoder | `.qoder/` | `~/.qoder/skills/` |
| Rovo Dev | `.rovodev/` | `~/.rovodev/skills/` |
| Mistral Vibe | `.vibe/` | `~/.vibe/skills/` |
| Trae | `.trae/` | `~/.trae/skills/` |
| Trae China | `.trae-cn/` | `~/.trae-cn/skills/` |

For example: `mkdir -p your-project/.claude/skills && cp -r .claude/skills/impeccable your-project/.claude/skills/`.

Notes:
- A manual copy skips the design hook and subagents. Run `npx impeccable install` to get them; it writes each tool's hook pointing at the right skill path.
- OpenCode also needs `.opencode/commands/impeccable.md` copied into your project's `.opencode/commands/` to provide `/impeccable`.
- Hermes asks you to trust project-local skills once: run `hermes skills trust` from the project root. Global installs need no trust step.
- Cursor and Gemini CLI may need Agent Skills enabled in settings. See the [Cursor](https://cursor.com/docs/context/skills) and [Gemini CLI](https://geminicli.com/docs/cli/skills/) skills docs.
- Restart Trae after copying.
- `impeccable install` and `update` manage a DeepSeek Harness global copy only when `DSH_HOME` is inside your home directory.

</details>

## Project files and git

Impeccable writes its working files under `.impeccable/`. A few are shared project artifacts and belong in the repo: `config.json`, `live/config.json`, `design.json`, `surfaces/*.md`, and `critique/*.md`. Keep `PRODUCT.md` and `DESIGN.md` in the repo too. The rest is screenshots, caches, and runtime state.

<details>
<summary><b>Copy the <code>.gitignore</code> entries</b></summary>

```gitignore
# impeccable-ignore-start
# Ephemeral output, runtime state, and per-dev overrides.
# The **/ prefix covers .impeccable at the repo root or in a nested workspace.
# Shared artifacts stay tracked: config.json, live/config.json,
# design.json, surfaces/*.md, critique/*.md.
**/.impeccable/config.local.json
**/.impeccable/hook.cache.json
**/.impeccable/hook.pending.json
**/.impeccable/*.png
**/.impeccable/review/
**/.impeccable/questions/
**/.impeccable/live/server.json
**/.impeccable/live/sessions/
**/.impeccable/live/previews/
**/.impeccable/live/annotations/
**/.impeccable/live/cache/
**/.impeccable/live/manual-edit-apply-transaction.json
**/.impeccable/live/manual-edit-events.jsonl
**/.impeccable/live/manual-edit-evidence/
**/.impeccable/live/pending-manual-edits.json
**/.impeccable/live/deferred-svelte-component-accepts.json
**/.impeccable/live/*.png
# impeccable-ignore-end
```

</details>

The folders that hold decision-round state (`.impeccable/questions/`, `.impeccable/mocks/worlds/`) also ignore themselves. A `.gitignore` can't untrack a file git already tracks; if you committed one earlier, run `git rm --cached <path>`.

## Good to know

**Build path.** For new landing pages and showcase surfaces, Impeccable can generate a full-fidelity comp first and build to match it (bolder, slower), or build straight in code (leaner, faster). App screens and documents are always built in code. `init` asks once and saves the answer as `buildPath` in `.impeccable/config.json`; the decision page lets you override it for one session. The choice only appears when your harness can generate images. [Image generation](https://impeccable.style/docs/image-generation) · [Configuration](https://impeccable.style/docs/config).

**Hooks run outside model approval.** In Claude Code, installed command hooks run even when you deny the model's own commands, so the first edit can download the engine. Review installed hooks before unattended runs, or pass `--settings '{"disableAllHooks": true}'` to turn them off for a run. The installer leaves hook entries it didn't add alone.

**Something broken?** `/impeccable doctor` finds stale context files, unused settings, and broken hooks. [Fix setup problems](https://impeccable.style/docs/doctor).

**Telemetry.** When a new design starts, the skill fetches a set of visual directions from the impeccable.style catalog. Turning telemetry off doesn't stop that request; it stops the anonymous record of which directions were shown and which one you picked, which is how the catalog learns what works. Your project name, files, code, and `PRODUCT.md` are never sent. Disable telemetry with `npx impeccable telemetry off`, `DO_NOT_TRACK=1`, or `"telemetry": false` in `.impeccable/config.json` for the whole project. The full list of what is sent is on the [privacy page](https://impeccable.style/privacy).

## Community

- [Issues](https://github.com/pbakaus/impeccable/issues) for bugs, questions, and ideas. Outside contributions start with an issue; see [DEVELOP.md](docs/DEVELOP.md).
- [Changelog](https://impeccable.style/changelog) for what shipped.
- Follow [@pbakaus](https://x.com/pbakaus) for release notes and new rules.

## License

Apache 2.0. See [LICENSE](LICENSE). Impeccable started from Anthropic's [frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design) skill.

---

Created by [Paul Bakaus](https://www.paulbakaus.com)
