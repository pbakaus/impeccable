# /impeccable hooks

Manage the **design detector hook** for the current project.

The hook runs the impeccable design detector on direct file edits to design-relevant files (`.tsx`, `.jsx`, `.html`, `.vue`, `.svelte`, `.astro`, `.css`, `.scss`, `.sass`, `.less`, `.ts`, `.js`). Claude Code and Codex use `PostToolUse` and push a short system reminder into the agent's context after the edit; findings get a correction prompt, pending issues get a re-nudge, and clean UI-ish files get a short ack unless `IMPECCABLE_HOOK_QUIET=1` is set. Plain `.ts` and `.js` files are still scanned, but stay quiet unless the detector finds something. Cursor uses `preToolUse` to block bad proposed writes before they land and stays silent when it allows a clean write.

This command toggles the hook **per project** by editing `.impeccable/hook.json`. Local-only ignore policy lives in `.impeccable/hook.local.json`, which is gitignored. To disable globally, set `IMPECCABLE_HOOK_DISABLED=1` in your shell environment.

Supported harnesses: Claude Code (`.claude/settings.local.json` in the project, which is gitignored so the hook stays machine-local; a hook you move into the shared `settings.json` is honored in place too), Codex (`.codex/hooks.json` in the project), and Cursor (`.cursor/hooks.json` in the project).

On **Cursor**, `preToolUse` checks proposed Write/Edit/Shell write content and denies only when the real detector finds an issue. The denial message is visible to the agent as the tool error, so the agent can reconsider before the bad write lands.

## Routing

The first argument is the action. Defaults to `status`.

| Action | What it does |
|---|---|
| `status` | Print current state, shared/local config paths, ignored rules / files / values, env override. |
| `on` | Set `enabled: true` in `.impeccable/hook.json`. |
| `off` | Set `enabled: false` in `.impeccable/hook.json`. |
| `ignore-rule <id>` | Append `<id>` to `ignoreRules`; for `overused-font`, requires `--all-values`. |
| `ignore-file <glob>` | Append `<glob>` to `ignoreFiles`. |
| `ignore-value <id> <value> [--shared] [--reason "..."]` | Append a rule/value suppression to shared `.impeccable/hook.json`. |
| `ignore-value <id> <value> --local [--reason "..."]` | Append a private rule/value suppression to `.impeccable/hook.local.json`. |
| `reset` | Delete the project config, dedup cache, and Cursor pending queue. |

## Flow

1. Resolve the action from the user's argument. If no action was given, default to `status`.
2. Invoke the admin script and pass the user's output through verbatim:

   ```bash
   node .claude/skills/impeccable/scripts/hook-admin.mjs <action> [args...]
   ```

3. If `<action>` is `off`, follow up with a one-line note: "Done. New edits will not trigger the design hook in this project until you run `/impeccable hooks on`."
4. If `<action>` is `on`, follow up with: "Done. The design hook will fire after the next Edit/Write/MultiEdit on a UI file."
5. If `<action>` is `ignore-value`, `ignore-file`, or `ignore-rule`, just print the script output. The default scope is shared `.impeccable/hook.json`; add `--local` only when the user explicitly asks for a private exception.
6. If `<action>` is `status`, just print the script output. Do not add commentary unless the user asked a follow-up question.

## Intentional findings

The hook itself never writes ignore config. Persist an exception only after the user explicitly confirms the flagged issue is intentional, and always go through `hook-admin.mjs`.

Prefer the narrowest exception:

- If the finding line shows an exact `ignore-value` command, run that command. This writes shared `.impeccable/hook.json` by default.
- For `overused-font`, use `ignore-value` when the user confirms a specific font. Do not use `ignore-rule overused-font` for a specific font.
- If the finding has no value-specific command, such as `side-tab`, prefer `ignore-file <path>` for the current file.
- Use `ignore-rule <id>` only when the user asks to suppress that whole rule across the project. For broad overused-font suppression, use `ignore-rule overused-font --all-values` only when the user asks to ignore overused fonts generally.
- Do not add source comments such as `impeccable: ignore`; inline comments pollute code and are not a supported suppression mechanism.

Example value-specific exception:

```bash
node .claude/skills/impeccable/scripts/hook-admin.mjs ignore-value overused-font Inter --shared --reason "User confirmed Inter is intentional"
```

Example whole-rule font exception:

```bash
node .claude/skills/impeccable/scripts/hook-admin.mjs ignore-rule overused-font --all-values --reason "User asked to ignore overused fonts generally"
```

Example file-scoped exception:

```bash
node .claude/skills/impeccable/scripts/hook-admin.mjs ignore-file "src/legacy/Card.tsx"
```

## Constraints

- Never modify `.impeccable/hook.json` or `.impeccable/hook.local.json` by hand from this command. Always go through `hook-admin.mjs` so writes stay validated and the file shape stays consistent.
- Do not edit the hook scripts themselves (`hook.mjs`, `hook-lib.mjs`, `hook-before-edit.mjs`) from this flow. Those are skill plumbing.
- Cursor can block a proposed write when the detector finds a real issue. Claude Code and Codex do not block the edit; they emit a post-edit reminder instead. Disabling stops both blocking and reminders.
- The hook is bundled with the Impeccable skill and installed through project-local manifests: `.claude/settings.local.json`, `.codex/hooks.json`, and `.cursor/hooks.json`. On Codex, the user must approve the hook via `/hooks` the first time. On Cursor, confirm hooks are enabled under Settings -> Hooks.

## Failure modes

- If `.impeccable/hook.json` or `.impeccable/hook.local.json` is unreadable or malformed, the hook ignores that file and uses the remaining valid config/defaults. `hook-admin.mjs status` will show malformed files as ignored.
- If the user asks to "disable the hook" globally, suggest both options: `IMPECCABLE_HOOK_DISABLED=1` env var (one-shot, follows the shell), and `/impeccable hooks off` (persistent for this project, committable).
