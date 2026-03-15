---
name: next
description: Run the next pending recommendation from a previous audit or critique. Reads .impeccable-plan.md and executes the top-priority action, then updates the plan.
user-invokable: true
---

Execute the next pending recommendation from a previous `{{command_prefix}}audit` or `{{command_prefix}}critique` run.

## How It Works

1. Read the `.impeccable-plan.md` file in the project root
2. Find the first item under `## Pending` that hasn't been completed
3. Execute that command with the context and target specified in the plan
4. After execution, move the completed item from `## Pending` to `## Completed`
5. Show the user what's left

## Execution

**First**: Read `.impeccable-plan.md`. If it doesn't exist, tell the user:
> No plan found. Run `{{command_prefix}}audit` or `{{command_prefix}}critique` first to generate recommendations.

**Then**: Parse the first pending item. Each item has this format:
```
N. `{{command_prefix}}command-name` — Description of what to fix (context details)
```

**Execute** the command listed, passing along the **Target** from the plan header as the area argument and the item's context description as additional guidance for what to focus on.

**After execution**: Update `.impeccable-plan.md`:
- Remove the completed item from `## Pending`
- Add it to `## Completed` with a timestamp
- Renumber remaining pending items

**Finally**: Show remaining items:
- If more items remain: "Done. N items remaining. Run `{{command_prefix}}next` to continue."
- If no items remain: "All recommendations complete! Plan cleared." Then delete `.impeccable-plan.md`.

## Important

- Always read the plan file fresh before each execution — it may have been updated
- Preserve the plan file format exactly so future `{{command_prefix}}next` calls can parse it
- If a command fails or can't run, mark it as skipped (not completed) and move to the next one
- Do NOT modify the plan file structure beyond moving items between sections

**NEVER**:
- Run commands that aren't in the plan
- Skip items without telling the user why
- Delete the plan file while items remain
- Change the order of pending items
