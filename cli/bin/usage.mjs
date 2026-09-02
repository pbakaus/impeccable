export function printUsage() {
  console.log(`Usage: impeccable <command> [options]

Terminal:  npx impeccable ...     install, update, detect, ignores
Agent:     /impeccable ...        every design command
Docs:      https://impeccable.style/docs

\`impeccable polish\` in a shell is not polish. Design commands run in the agent.


────────────────────────────────────────────────────────
Start with /impeccable
────────────────────────────────────────────────────────

  1. npx impeccable install           From the project root, then reload the agent
  2. /impeccable init                 PRODUCT.md (and DESIGN.md when code exists)
  3. /impeccable polish the pricing page


────────────────────────────────────────────────────────
Learn
────────────────────────────────────────────────────────

Getting started
  npx impeccable install              Skill + hook into this project or user home
  npx impeccable update               Refresh an existing install
  npx impeccable check                See if a newer skill bundle exists
  npx impeccable link --source=.impeccable
                                      Symlink a git checkout / submodule
    --providers=claude,cursor,codex,github,gemini,grok,hermes,kiro,
                opencode,pi,qoder,trae,trae-cn,rovo-dev,vibe,
                veto,antigravity
    --scope=project|global            --project | --user
    -y, --yes                         Skip prompts
    --force                           Replace hook manifests / existing links
    --no-hooks                        Skills only; do not install or repair hooks
  impeccable skills <command>         Legacy namespace; still supported
  /impeccable pin audit | unpin audit Standalone /audit shortcut (any command)
  Reload the agent after install. Then trust the hook in the harness.

Iterate on UI with Live Mode
  /impeccable live                    Pick an element, three variants, accept
                                      into source. Vite, Next, SvelteKit,
                                      Astro, Nuxt. Next includes monorepos.
  From a monorepo root, pick the app first (or --target <app>).
  Live state lives in <that-app>/.impeccable/live/

Critique with the visual overlay
  /impeccable critique                UX review in the agent
  Chrome extension                    Same 61 rules as an overlay on any page


────────────────────────────────────────────────────────
Core concepts
────────────────────────────────────────────────────────

Design Context
  PRODUCT.md                          Audience, purpose, platform
  DESIGN.md                           Visual system
  .impeccable/design.json             Generated sidecar
  .impeccable/surfaces/*.md           Per-page / per-route briefs
  Platform                            web | ios | android | adaptive
  Mode (per surface, not per repo)    Persuade | Operate | Read | Experience

  More than one app
    Found via package.json workspaces, pnpm-workspace.yaml, lerna.json,
    or "projectRoots": ["apps/*"] in .impeccable/config.json
    Child PRODUCT.md / DESIGN.md wins; missing files inherit the repo root
    per file. A nested git repo does not inherit.
    --target <app|file|route> on context, live, and doctor.
    In a non-monorepo repo, --target still selects a nested product.
    From the repo root with no --target: pick an app, then rerun there.

Config and ignores
  npx impeccable ignores list
  npx impeccable ignores add-rule <id>
  npx impeccable ignores add-file <glob>
  npx impeccable ignores add-value <rule> <value>
  npx impeccable ignores remove-rule | remove-file | remove-value
  npx impeccable ignores clear
    --shared     .impeccable/config.json (default, commit this)
    --local      .impeccable/config.local.json (gitignored)
    --all        remove/clear both
    --file <glob> --reason <text>
  In-file:  impeccable-disable | -line | -next-line
  projectRoots in config.json (local.json can add private roots; !glob hides)
  Keep .gitignore .impeccable rules unanchored so apps/web/.impeccable matches
  .impeccable/live/config.json is shared; do commit it

New work
  /impeccable                         Describe a new surface in plain English
  Worlds, direction, then build. Replacement looks go through new-work,
  not polish-on-the-old-one.


────────────────────────────────────────────────────────
Automation
────────────────────────────────────────────────────────

Detector CLI
  npx impeccable detect [file|dir|url...]
    --json  --quiet  --scope type|layout  --viewport WxH
    --no-config  --no-inline-ignores  --no-design-system  --no-advisory
  Workspace files use that app's DESIGN.md, else the repo root's.
  Exit codes are CI-safe. Advisory findings never fail the gate.

Design hooks
  /impeccable hooks status | on | off
  /impeccable hooks ignore-rule | ignore-file | ignore-value
  install/update writes the manifest for Claude Code, Copilot, Codex,
  Cursor, Grok Build. The harness still has to trust it.

Doctor
  /impeccable doctor                  Context, DESIGN drift, ignores vs live
                                      rules, hook path, workspace table
    --json  --fix  --target <path>
  Flags projectRoots globs that match nothing.


────────────────────────────────────────────────────────
Commands          (agent: /impeccable <command> [target])
────────────────────────────────────────────────────────

Create
  impeccable      Next-step menu, or describe the work in plain English
  shape           Plan UX/UI before code

Evaluate
  audit           Technical quality, P0-P3
  critique        UX review, scoring, personas, detector

Refine
  animate         Purposeful motion
  bolder          Safe design, more impact
  colorize        Strategic color
  delight         Small memorable moments
  layout          Spacing, rhythm, composition
  overdrive       Shaders, physics, 60fps, cinematic
  quieter         Too loud, same intent
  typeset         Type hierarchy and fonts

Simplify
  adapt           Screens, devices, platforms
  clarify         UX copy, labels, errors
  distill         Strip to essence

Harden
  harden          Errors, i18n, overflow, edge cases
  onboard         First-run, empty states, activation
  optimize        UI performance
  polish          Last quality pass

System
  document        DESIGN.md from existing UI
  extract         Tokens and components into the system
  init            PRODUCT.md
  live            Browser variants into source

  pin / unpin     Standalone /audit (and friends)
  teach           Same as init
  craft           Deprecated new-work alias`);
}
