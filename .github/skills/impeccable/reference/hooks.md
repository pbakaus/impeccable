# /impeccable hooks

Manage the **design detector hook** for the current project.

The hook is a `PostToolUse` handler that runs the impeccable design detector after every direct file edit on a design-relevant file (`.tsx`, `.jsx`, `.html`, `.vue`, `.svelte`, `.astro`, `.css`, `.scss`, `.sass`, `.less`, `.ts`, `.js`). It pushes a short system reminder into the agent's context so the next turn can course-correct: findings get a correction prompt, pending issues get a re-nudge, and clean files get a short ack unless `IMPECCABLE_HOOK_QUIET=1` is set. Never blocks an edit.

This command toggles the hook **per project** by editing `.impeccable/hook.json`. Local-only ignore policy lives in `.impeccable/hook.local.json`, which is gitignored. To disable globally, set `IMPECCABLE_HOOK_DISABLED=1` in your shell environment.

Supported harnesses: Claude Code (plugin), Codex (plugin), Cursor (`.cursor/hooks.json` in the project).

On **Cursor**, findings surface as a one-shot **`stop` followup message** at end of turn (not inline `additional_context`). The `afterFileEdit` hook records findings; `stop` auto-submits the corrective nudge once per turn (`loop_limit: 1`).

## Routing

The first argument is the action. Defaults to `status`.

| Action | What it does |
|---|---|
| `status` | Print current state, shared/local config paths, ignored rules / files / values, env override. |
| `on` | Set `enabled: true` in `.impeccable/hook.json`. |
| `off` | Set `enabled: false` in `.impeccable/hook.json`. |
| `ignore-rule <id>` | Append `<id>` to `ignoreRules`. |
| `ignore-file <glob>` | Append `<glob>` to `ignoreFiles`. |
| `ignore-value <id> <value> [--reason "..."]` | Append a rule/value suppression to local `.impeccable/hook.local.json`. |
| `ignore-value <id> <value> --shared [--reason "..."]` | Append a rule/value suppression to shared `.impeccable/hook.json`. |
| `reset` | Delete the project config, dedup cache, and Cursor pending queue. |

## Flow

1. Resolve the action from the user's argument. If no action was given, default to `status`.
2. Invoke the admin script and pass the user's output through verbatim:

   ```bash
   node .github/skills/impeccable/scripts/hook-admin.mjs <action> [args...]
   ```

3. If `<action>` is `off`, follow up with a one-line note: "Done. New edits will not trigger the design hook in this project until you run `/impeccable hooks on`."
4. If `<action>` is `on`, follow up with: "Done. The design hook will fire after the next Edit/Write/MultiEdit on a UI file."
5. If `<action>` is `ignore-value`, just print the script output. The default is local-only; add `--shared` only when the user explicitly asks for team/shared policy.
6. If `<action>` is `status`, just print the script output. Do not add commentary unless the user asked a follow-up question.

## Intentional findings

If the hook flags a value and the user explicitly insists that value is intentional, prefer a value ignore over inline source comments. Example:

```bash
node .github/skills/impeccable/scripts/hook-admin.mjs ignore-value overused-font Inter --reason "User confirmed Inter is intentional"
```

Only use `ignore-rule` for broad project-level exceptions and `ignore-file` for legacy/generated sections that should not be checked at all.

## Constraints

- Never modify `.impeccable/hook.json` or `.impeccable/hook.local.json` by hand from this command. Always go through `hook-admin.mjs` so writes stay validated and the file shape stays consistent.
- Do not edit the hook scripts themselves (`hook.mjs`, `hook-lib.mjs`, `hook-after-edit.mjs`, `hook-stop.mjs`) from this flow. Those are skill plumbing.
- The hook never blocks edits, including when disabled is toggled. Disabling stops it from emitting findings; it does not interfere with the tool call that triggered it.
- The hook is bundled with the Impeccable skill on Claude Code (plugin), Codex (plugin), and Cursor (`.cursor/hooks.json`). On Codex, the user must also enable `[features].hooks = true` in `~/.codex/config.toml` and approve the hook via `/hooks` the first time. On Cursor, confirm hooks are enabled under Settings → Hooks.

## Failure modes

- If `.impeccable/hook.json` or `.impeccable/hook.local.json` is unreadable or malformed, the hook ignores that file and uses the remaining valid config/defaults. `hook-admin.mjs status` will show malformed files as ignored.
- If the user asks to "disable the hook" globally, suggest both options: `IMPECCABLE_HOOK_DISABLED=1` env var (one-shot, follows the shell), and `/impeccable hooks off` (persistent for this project, committable).
