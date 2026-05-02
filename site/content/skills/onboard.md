---
tagline: "Design first-run experiences, empty states, and paths to value."
---

## When to use it

`/impeccable onboard` is for the moments that decide whether a new user sticks around: the first screen, the empty state, the setup flow, the product tour, the "what do I do now" gap. Reach for it when activation is weak, when new users drop off before reaching value, or when your product has empty states that say "no items yet" and stop there.

## How it works

The command starts from one question: what is the aha moment, and how fast can a new user get there. Every design decision points at that moment.

It works across the surfaces that shape first impressions:

1. **First-run experience**: the moments immediately after sign-up. Should the user see a tour, a blank canvas, a filled example, or nothing at all. Pick the approach that matches the product.
2. **Empty states**: every zero-data screen gets oriented. Where am I, why is this empty, what do I do next, what will it look like once it is full.
3. **Setup and installation**: required configuration is minimized, defaults are smart, each step explains why it matters.
4. **Progressive disclosure**: advanced features stay out of the way until they are earned.
5. **Activation events**: the moment a user first experiences the core value is instrumented and celebrated, quietly.

The command resists two common failure modes: over-tutorialized onboarding where users click through a carousel before they can touch anything, and zero-onboarding where users are dropped into an empty app and expected to figure it out.

## Try it

```
/impeccable onboard the editor
```

Typical output:

- First-run: replaces empty editor with a filled example document the user can modify. Cancel button discards the example, edit replaces the content with the user's work.
- Empty state on document list: "No documents yet. Create your first, or import from Notion, Google Docs, or Markdown."
- Setup: reduced from 6 required fields to 1 (workspace name). Everything else has a smart default and can be edited later in settings.
- Activation: the first time a user saves a document, a quiet toast says "Saved. Your work is in the cloud now." One-time, not repeated.

## Pitfalls

- **Adding a product tour as the default answer.** Most products do not need a tour. They need a better first screen. Tours are a crutch.
- **Designing onboarding without defining the aha moment.** If you cannot say in one sentence what the user should feel in the first 60 seconds, go back to `/impeccable shape` first.
- **Running onboard on a broken flow.** Fix the flow first. Onboarding cannot rescue a product where the core action is broken.
