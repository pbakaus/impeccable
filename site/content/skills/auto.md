---
tagline: "Plain English in, the right Impeccable workflow out."
---

## When to use it

`/impeccable auto` is for the moment when you know what should improve but do not want to remember the command catalog.

Use it for requests like:

```
/impeccable auto make this dashboard easier to scan
/impeccable auto this checkout feels untrustworthy
/impeccable auto get this page ready to ship
```

Auto chooses a primary command, loads supporting references only when they matter, and runs the work. It is the shortest path from intent to action.

## How it works

Auto reads the same project context as every other command: `PRODUCT.md`, `DESIGN.md`, the current register, representative source files, and detector signals when local scannable files exist.

Then it classifies the request:

1. **Build**: new work goes to `craft` or `shape`.
2. **Evaluate**: "what is wrong" goes to `critique` or `audit`.
3. **Refine**: rough but working UI goes to `polish`, `layout`, `typeset`, `colorize`, or another focused command.
4. **Harden**: production, edge cases, responsive issues, or performance go to `harden`, `adapt`, `optimize`, or `audit`.
5. **Explore visually**: browser element variants go to `live`.

For mixed requests, auto picks one command to own the flow and adds a small support set. "Make this page good" usually starts with `polish`, with `layout`, `typeset`, `colorize`, or `clarify` folded in as needed. "Ready to ship" starts with `audit`, then routes fixes to `harden` and `polish`.

## Try it

```
/impeccable auto make this onboarding flow clearer on mobile
```

A healthy route looks like:

```
Auto route: adapt with clarify and harden because the request is about mobile clarity and production behavior.
```

Then it proceeds with that workflow. You do not get a command menu unless the request is not actionable.

## Pitfalls

- **Using auto to avoid product context.** Auto still needs `PRODUCT.md` and `DESIGN.md` to avoid generic output. Run `/impeccable init` first on new projects.
- **Expecting every command at once.** Auto is selective. A smart route is usually one primary command and two or three supporting concerns.
- **Leaving the target vague when many surfaces changed.** Auto will infer from the dirty tree, current route, or obvious file names, but naming the page or component still improves the result.
