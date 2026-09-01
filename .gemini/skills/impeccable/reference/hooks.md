# /impeccable hooks

Manage the **design detector hook** for the current project.

The hook runs the impeccable design detector on direct file edits to design-relevant files (`.tsx`, `.jsx`, `.html`, `.vue`, `.svelte`, `.astro`, `.css`, `.scss`, `.sass`, `.less`, `.ts`, `.js`). Claude Code, Codex, and GitHub Copilot use a post-tool-use hook and push a short system reminder into the agent's context after the edit; findings get a correction prompt, pending issues get a re-nudge, and clean UI-ish files get a short ack unless quiet mode is on (`hook.quiet` in config). Plain `.ts` and `.js` files are still scanned, but stay quiet unless the detector finds something. Cursor uses `preToolUse` to block bad proposed writes before they land and stays silent when it allows a clean write. Grok Build fires the same PostToolUse scan to mark touched files, then surfaces findings on Stop `additionalContext`. Do not expect a Grok per-edit reminder: Grok discards that stdout.

The detector rules run in two tiers. The per-edit hook surfaces only the immediate tier: mechanical, unambiguous problems worth interrupting an edit for, such as broken images, overflowing or clipped content, contrast and legibility failures, gradient text, glow shadows, and design-system drift. Everything else (copy cadence, palette and typography taste, layout rhythm) is deferred to a deep pass on the `Stop` hook event, which runs the full rule set over every UI file touched in the session and surfaces the remaining findings once, deduplicated against what the per-edit pass already reported. A session with nothing left to report stops silently. Set `hook.perEditRules` to `"all"` in `.impeccable/config.json` to restore the full rule set on every edit. The Stop deep pass is wired for Claude Code, Codex, and Grok Build, which dispatch a native `Stop` hook event. Cursor does not get one (its stop hook is not consistently dispatched; the pre-write gate covers it), and GitHub Copilot's stop-style events do not feed context back to the model, so they keep the full detector per edit. Grok also fires an observe-only Stop with `reason: "shutdown"` after `end_turn`; skip that one, scan only `end_turn`.

Every hook is a mechanical pass. The reflexes no scanner catches live in [craft-floor.md](craft-floor.md), which the skill loads before it edits UI, so they apply whether or not a hook is wired. A session with no automatic hook gets one `MANUAL_DETECTOR_REQUIRED` directive from `context.mjs` asking for a single detector run at the end.

This command toggles the hook **per project** by editing `.impeccable/config.json` (the unified Impeccable config; hook runtime settings live under its `hook` key, and shared detector ignores live under `detector`). Per-developer overrides, including the install consent decision (`hook.consent`) the CLI records, live in the gitignored `.impeccable/config.local.json`. Set `hook.enabled: false` to turn the hook off, `hook.quiet: true` to silence the clean/pending acks, or `hook.auditLog` to a file path for an NDJSON log. The legacy `IMPECCABLE_HOOK_DISABLED`, `IMPECCABLE_HOOK_QUIET`, and `IMPECCABLE_HOOK_LOG` env vars are still honored and override these config values when set.

Declare server-side template extensions under **`detector.extensions`** when the project uses Blade, Twig, ERB, or Handlebars files; the hook skips them otherwise because they sit outside the built-in extension list. One entry per extension, `{ "ext": ".blade.php", "engine": "html" }`. `engine` picks the analyzer (`html` for markup templates, `text` for JS/TS/CSS-like files) and defaults to `html`. Match against the end of the filename, so double extensions like `.blade.php` and `.html.erb` work. Config only adds extensions; the built-in list always applies.

Manual `npx impeccable detect` scans use the same project filter config by default: `detector.ignoreRules`, `detector.ignoreFiles`, `detector.ignoreValues`, and `detector.designSystem.enabled`. `hook.enabled` only controls automatic hook execution, not manual CLI scans. Use `npx impeccable detect --no-config ...` for a raw detector run that ignores project config/context. Use `npx impeccable ignores ...` for direct CLI CRUD on the same detector ignores.

Supported harnesses: Claude Code (`.claude/settings.local.json` in the project, which is gitignored so the hook stays machine-local; a hook you move into the shared `settings.json` is honored in place too), Codex (`.codex/hooks.json` in the project), Cursor (`.cursor/hooks.json` in the project), Grok Build (`.grok/hooks/impeccable.json` in the project; requires `/hooks-trust` or `--trust`), and GitHub Copilot (`.github/hooks/impeccable.json` in the project, a team-shared committed file that both the Copilot CLI and the cloud agent read). For the Copilot CLI, repo-level hooks fire once `.github/hooks/impeccable.json` is committed to the repository's default branch.

On **Cursor**, `preToolUse` checks proposed Write/Edit/Shell write content and denies only when the real detector finds an issue. The denial message is visible to the agent as the tool error, so the agent can reconsider before the bad write lands.

## Routing

The first argument is the action. Defaults to `status`.

| Action | What it does |
|---|---|
| `status` | Print current state, shared/local config paths, ignored rules / files / values, env override. |
| `on` | Set `enabled: true` in `.impeccable/config.json`, record local hook consent as accepted, and install/repair provider hook manifests when the skill is installed. |
| `off` | Set `enabled: false` in `.impeccable/config.json`. |
| `ignore-rule <id>` | Append `<id>` to `detector.ignoreRules`; for `overused-font`, requires `--all-values`. Suppresses the rule across the whole project. |
| `ignore-file <glob>` | Append `<glob>` to `detector.ignoreFiles`. Suppresses **every** rule for matching files. |
| `ignore-value <id> <value> [--shared] [--reason "..."]` | Append a rule/value suppression to shared `.impeccable/config.json`. |
| `ignore-value <id> <value> --local [--reason "..."]` | Append a private rule/value suppression to `.impeccable/config.local.json`. |
| `ignore-value <id> "*" --file <glob> [--file <glob>...]` | Turn one rule off in matching files only, leaving it active everywhere else. Repeat `--file`, or use `--file=<glob>` / `--files=<glob>`. A bare `"*"` with no `--file` is refused: use `ignore-rule <id>` if you really mean project-wide. |
| `reset` | Delete the project config, dedup cache, and Cursor pending queue, and remove the hook's entries from every provider manifest `on` installs, the committed Copilot file included (a team-shared `settings.json` that `on` never writes is never touched). |

## Flow

1. Resolve the action from the user's argument. If no action was given, default to `status`.
2. Invoke the admin script and pass the user's output through verbatim:

   ```bash
   node .gemini/skills/impeccable/scripts/hook-admin.mjs <action> [args...]
   ```

3. If `<action>` is `off`, follow up with a one-line note: "Done. New edits will not trigger the design hook in this project until you run `/impeccable hooks on`."
4. If `<action>` is `on`, follow up with: "Done. The design hook will fire after the next Edit/Write on a UI file."
5. If `<action>` is `ignore-value`, `ignore-file`, or `ignore-rule`, just print the script output. The default scope is shared `.impeccable/config.json`; add `--local` only when the user explicitly asks for a private exception.
6. If `<action>` is `status`, just print the script output. Do not add commentary unless the user asked a follow-up question.

## Triage findings

The hook itself never writes ignore config; every exception goes through `hook-admin.mjs`. Triage each finding into one of three outcomes:

- **Real design problem**: fix it. Never add an ignore to skip a fix or to push a blocked write through.
- **Confident false positive or sanctioned exception**: persist the narrowest ignore yourself and disclose it in your reply. The bar is evidence you can name: an intentional demo or fixture, documentation of bad design, literal or domain-appropriate motion (a ball that bounces), or a choice the user already confirmed. Put that evidence in `--reason` as `"<who decided: evidence>"`; write "user confirmed" only when the user actually did.
- **Unsure**: leave the finding standing and ask the user in one line. Ask once; a one-line question costs less than the hook re-firing on every later edit.

Self-serve stops at `ignore-value`. `ignore-file` and `ignore-rule` silence too much to add on your own judgment; ask the user first.

Prefer the narrowest exception:

- If the finding line shows an `ignore-value <rule> <value>` pair, pass it to `hook-admin.mjs ignore-value` with your `--reason`. This writes shared `.impeccable/config.json` by default.
- For value-specific findings such as `overused-font` and `bounce-easing`, use `ignore-value` for the specific value. Do not use `ignore-rule overused-font` for a specific font.
- If the finding has no value-specific command, such as `side-tab`, scope that one rule to the file: `ignore-value <id> "*" --file <path>`. Run `npx impeccable detect <path>` first to see what actually fires there.
- Reach for `ignore-file <path>` only when the whole file is out of scope for design review: a fixture, a generated artifact, a deliberate slop demo. It silences every rule for that file permanently, including rules that have not been written yet. A real UI surface with one noisy rule wants the file-scoped value ignore above.
- Use `ignore-rule <id>` only when the user asks to suppress that whole rule across the project. For broad overused-font suppression, use `ignore-rule overused-font --all-values` only when the user asks to ignore overused fonts generally.
- Prefer config ignores (the commands above) by default; they keep suppressions in one reviewable place. Reach for an inline comment only when the waiver must travel with a single file that leaves the repo (a generated/exported standalone document, an emailed HTML file). The supported marker is `impeccable-disable <rule>` (whole file) or `impeccable-disable-line` / `impeccable-disable-next-line` (one line), in any comment syntax, with an optional reason after `:` or `--`. The detector honors it by default; `--no-inline-ignores` or `--no-config` bypasses it.

Example value-specific exception:

```bash
node .gemini/skills/impeccable/scripts/hook-admin.mjs ignore-value overused-font Inter --shared --reason "User confirmed Inter is intentional"
```

Example self-served exception, with the evidence named:

```bash
node .gemini/skills/impeccable/scripts/hook-admin.mjs ignore-value bounce-easing bounce-ball --shared --reason "Agent: literal ball-bounce animation, bounce easing is the subject"
```

Example whole-rule font exception:

```bash
node .gemini/skills/impeccable/scripts/hook-admin.mjs ignore-rule overused-font --all-values --reason "User asked to ignore overused fonts generally"
```

Example one-rule-in-one-file exception, for a file that is still worth reviewing
for everything else:

```bash
node .gemini/skills/impeccable/scripts/hook-admin.mjs ignore-value design-system-font-size "*" --file "src/overlay/widget.js" --reason "Injected widget builds its own type scale; DESIGN.md's ramp describes the site"
```

Example whole-file exception, for a file that is out of scope entirely:

```bash
node .gemini/skills/impeccable/scripts/hook-admin.mjs ignore-file "src/legacy/Card.tsx"
```

## Constraints

- Never modify `.impeccable/config.json` or `.impeccable/config.local.json` by hand from this command. Always go through `hook-admin.mjs` so writes stay validated and the file shape stays consistent. One exception: `detector.extensions` has no admin action, so when the user asks to cover a template stack, edit that one field in `.impeccable/config.json` directly and leave the rest of the file untouched.
- Do not edit the hook scripts themselves (`hook.mjs`, `hook-lib.mjs`, `hook-before-edit.mjs`) from this flow. Those are skill plumbing.
- The design context document's Hooks page reads and writes this same config through `hook-admin.mjs` (`state` and `apply`, its machine channel, called by the doc session); those two verbs are not part of this command's routing. Entries it wrote are user decisions: the person pressed Apply in the page, so treat them like any user-made config.
- Cursor can block a proposed write when the detector finds a real issue. Claude Code, Codex, and GitHub Copilot do not block the edit; they emit a post-edit reminder instead. Disabling stops both blocking and reminders.
- The hook is bundled with the Impeccable skill and installed through project-local manifests: `.claude/settings.local.json`, `.codex/hooks.json`, `.cursor/hooks.json`, and `.github/hooks/impeccable.json`. On Codex, the user must approve the hook via `/hooks` the first time. On Cursor, confirm hooks are enabled under Settings -> Hooks. On GitHub Copilot, the CLI loads `.github/hooks/impeccable.json` once it is committed to the repository's default branch, and the cloud agent reads it from the repo directly.

## Failure modes

- If `.impeccable/config.json` or `.impeccable/config.local.json` is unreadable or malformed, the hook ignores that file and uses the remaining valid config/defaults. `hook-admin.mjs status` will show malformed files as ignored.
- If the user asks to "disable the hook" globally, lead with `/impeccable hooks off` (persistent for this project; writes `hook.enabled: false` to config). The legacy `IMPECCABLE_HOOK_DISABLED=1` env var also works as a one-shot override that follows the shell.
