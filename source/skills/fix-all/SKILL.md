---
name: fix-all
description: Run all pending recommendations from a previous audit or critique in priority order. Reads .impeccable-plan.md and executes each action sequentially.
user-invokable: true
---

Execute ALL pending recommendations from a previous `{{command_prefix}}audit` or `{{command_prefix}}critique` run, in priority order.

## How It Works

1. Read the `.impeccable-plan.md` file in the project root
2. Execute each pending item in order, from highest to lowest priority
3. After each command completes, move it from `## Pending` to `## Completed`
4. Continue until all items are done
5. Clean up the plan file when finished

## Execution

**First**: Read `.impeccable-plan.md`. If it doesn't exist, tell the user:
> No plan found. Run `{{command_prefix}}audit` or `{{command_prefix}}critique` first to generate recommendations.

**Then**: Show the user the full plan before starting:
```
Found N pending recommendations:
1. command-name — Description
2. command-name — Description
...
Running all in sequence.
```

**For each pending item**:
1. Announce: "Running N/total: `{{command_prefix}}command-name` — description..."
2. Execute the command by invoking it as a skill. {{invoke_skill_instruction}} The commands in the plan are all impeccable design skills (like `harden`, `normalize`, `adapt`, `polish`, etc.). Pass the **Target** from the plan header as the area argument and the item's context as focus guidance.
3. Update `.impeccable-plan.md` — move item to `## Completed` with timestamp
4. Brief status: "Done. Moving to next..."

**After all items complete**:
- Show summary: "All N recommendations complete!"
- List what was done
- Delete `.impeccable-plan.md`

## Error Handling

If a command fails or produces unexpected results:
- Mark the item as **skipped** in the plan (not completed)
- Log the reason: "Skipped: command-name — reason"
- Continue to the next item
- At the end, report skipped items separately so the user can address them manually

## Important

- Re-read the plan file before EACH command execution in case it was modified
- This is a sequential pipeline — each command may change the code that the next command operates on, so order matters
- Always preserve the plan file format between executions
- The plan file acts as a checkpoint — if interrupted, `{{command_prefix}}next` can resume from where this left off

**NEVER**:
- Run commands in parallel (order is intentional)
- Skip items silently
- Continue if the plan file is missing or corrupted
- Delete the plan file while skipped items remain
