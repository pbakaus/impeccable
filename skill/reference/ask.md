# Workflow Guide

Use this reference when the question is not "what next?" but "where should I start?"

`routing.md` answers **"What should I do next in this project?"** by reading the current project state.

This guide answers **"I'm in this situation: what path should I take?"** It helps choose the right workflow before selecting a command.

Use it to choose an entry point, understand workflow dependencies, and distinguish commands that are easy to confuse.

## The default workflow

For a typical design project, some commands build on outputs produced by earlier commands.

```text
init
  ↓
shape
  ↓
implement the surface
  ↓
critique
  ↓
harden
  ↓
polish
```

Not every project starts at `init`, and not every task ends at `polish`.

Think of this as the main path through the system, not a mandatory sequence for every request.

## Workflow entry points

You do not need to start at `init` for every request. Choose the entry point that matches the work already in front of you.

| Situation | Start here | Why |
|---|---|---|
| Starting a brand-new product. | `init` | Capture durable product context before design work begins. |
| Designing a new feature for an existing product. | `shape` | Plan the feature within the existing product context instead of reopening `init`. |
| Exploring or planning a new interface before implementation. | `shape` | Define UX, information architecture, and interaction direction before implementation. |
| Inheriting an existing project with code or designs. | `audit` → `critique` | Understand technical health first, then evaluate design quality. |
| Improving an existing interface. | `critique` | Generate a design backlog before making refinements. |
| Refining a design after a critique. | `harden` → `polish` | Address production concerns first, then complete the final refinement pass. |
| Preparing a feature for release. | `harden` | Handle edge cases, resilience, errors, and release readiness before the final polish pass. |
| Generating `DESIGN.md` for an existing project. | `document` | Scan the project and generate documentation for the existing design system. |
| Extracting reusable design primitives into the design system. | `extract` | Pull reusable tokens and components into the project's design system. |
| Improving a specific aspect of an interface. | Jump directly to the matching command. | Use focused commands such as `layout`, `typeset`, `clarify`, `colorize`, or `animate` when the goal is already known. |

## Common workflows

These workflows describe common paths through the system. They are examples, not mandatory sequences.

### Improve an existing interface

```text
critique
  ↓ writes a critique snapshot

harden
  ↓ addresses production readiness

polish
  ↓ performs the final refinement pass
```

Run `critique` before `harden`, then finish with `polish` when preparing work for shipping.

### Start a new product

```text
init
  ↓ captures product context

shape
  ↓ plans UX and interface direction

implement the surface
  ↓ create the interface in code

critique
  ↓ evaluates the implemented surface

harden
  ↓ prepares the implementation for production

polish
  ↓ completes the final refinement pass
```

### Documentation workflows

`document` and `extract` solve different problems.

- `document` scans an existing project and generates `DESIGN.md`.
- `extract` pulls reusable design tokens and components into the design system.

Neither command is a prerequisite for the other.

## Choosing between similar commands

Some commands solve adjacent problems. Use this guide when more than one command seems applicable.

| If you're deciding between... | Choose... |
|---|---|
| `critique` vs `audit` | **`critique`** evaluates UX and visual design quality. **`audit`** checks accessibility, responsiveness, performance, and technical implementation quality. |
| `clarify` vs `harden` | **`clarify`** improves copy, labels, and communication. **`harden`** prepares the interface for production by handling edge cases and resilience. |
| `distill` vs `quieter` | **`distill`** removes unnecessary complexity. **`quieter`** keeps the design but reduces visual intensity. |
| `bolder` vs `overdrive` | **`bolder`** strengthens an existing design direction. **`overdrive`** intentionally pushes beyond conventional UI patterns. |
| `layout` vs `typeset` | **`layout`** improves spacing, hierarchy, and composition. **`typeset`** improves typography hierarchy, font choices, and readability. |
| `document` vs `extract` | **`document`** generates `DESIGN.md` from an existing project. **`extract`** pulls reusable tokens and components into the design system. |