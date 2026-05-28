# /impeccable hooks

Manage the **design detector hook** for the current project.

The hook is a `PostToolUse` handler that runs the impeccable design detector after every `Edit`, `Write`, or `MultiEdit` on a design-relevant file (`.tsx`, `.jsx`, `.html`, `.vue`, `.svelte`, `.astro`, `.css`, `.scss`, `.less`, `.ts`, `.js`). When findings exist, it pushes a short system reminder into the agent's context so the next turn can course-correct. Silent on clean files. Never blocks an edit.

This command toggles the hook **per project** by editing `.impeccable/hook.json`. To disable globally, set `IMPECCABLE_HOOK_DISABLED=1` in your shell environment.

## Routing

The first argument is the action. Defaults to `status`.

| Action | What it does |
|---|---|
| `status` | Print current state, config file path, ignored rules / files, env override. |
| `on` | Set `enabled: true` in `.impeccable/hook.json`. |
| `off` | Set `enabled: false` in `.impeccable/hook.json`. |
| `ignore-rule <id>` | Append `<id>` to `ignoreRules`. |
| `ignore-file <glob>` | Append `<glob>` to `ignoreFiles`. |
| `reset` | Delete the project config and the dedup cache. |

## Flow

1. Resolve the action from the user's argument. If no action was given, default to `status`.
2. Invoke the admin script and pass the user's output through verbatim:

   ```bash
   node .trae-cn/skills/impeccable/scripts/hook-admin.mjs <action> [args...]
   ```

3. If `<action>` is `off`, follow up with a one-line note: "Done. New edits will not trigger the design hook in this project until you run `/impeccable hooks on`."
4. If `<action>` is `on`, follow up with: "Done. The design hook will fire after the next Edit/Write/MultiEdit on a UI file."
5. If `<action>` is `status`, just print the script output. Do not add commentary unless the user asked a follow-up question.

## Constraints

- Never modify `.impeccable/hook.json` by hand from this command. Always go through `hook-admin.mjs` so writes stay validated and the file shape stays consistent.
- Do not edit the hook scripts themselves (`hook.mjs`, `hook-lib.mjs`, `hook-session-start.mjs`) from this flow. Those are skill plumbing.
- The hook never blocks edits, including when disabled is toggled. Disabling stops it from emitting findings; it does not interfere with the tool call that triggered it.
- The hook is bundled with the Impeccable plugin on Claude Code and Codex. There is no install step beyond enabling the plugin. On Codex, the user must also enable `[features].hooks = true` in `~/.codex/config.toml` and approve the hook via `/hooks` the first time.

## Failure modes

- If `.impeccable/hook.json` is unreadable or malformed, the hook treats it as defaults (`enabled: true`). `hook-admin.mjs status` will show "(using defaults; file not present)".
- If the user asks to "disable the hook" globally, suggest both options: `IMPECCABLE_HOOK_DISABLED=1` env var (one-shot, follows the shell), and `/impeccable hooks off` (persistent for this project, committable).
