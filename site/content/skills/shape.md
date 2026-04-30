---
tagline: "Think before you build. Produce a design brief through discovery, not guesswork."
---

<div class="docs-viz-hero">
  <div class="docs-viz-file">
    <div class="docs-viz-file-header">
      <span class="docs-viz-file-name">brief.md</span>
      <span class="docs-viz-file-status">Output of /impeccable shape</span>
    </div>
    <div class="docs-viz-file-body">
      <div class="docs-viz-file-row">
        <span class="docs-viz-file-k">Purpose</span>
        <span class="docs-viz-file-v">Let committed subscribers change what they get without losing them to unsubscribe.</span>
      </div>
      <div class="docs-viz-file-row">
        <span class="docs-viz-file-k">User</span>
        <span class="docs-viz-file-v">Rushed, on mobile, mid-meeting. Reading fast, low patience.</span>
      </div>
      <div class="docs-viz-file-row">
        <span class="docs-viz-file-k">Content</span>
        <span class="docs-viz-file-v">4 digest types, 2 cadences, one opt-out-all at the bottom.</span>
      </div>
      <div class="docs-viz-file-row">
        <span class="docs-viz-file-k">Feeling</span>
        <span class="docs-viz-file-v">Calm, trustworthy, no dark patterns.</span>
      </div>
      <div class="docs-viz-file-row">
        <span class="docs-viz-file-k">Constraints</span>
        <span class="docs-viz-file-v">Mobile-first. WCAG AA contrast. One column, no modals.</span>
      </div>
    </div>
    <div class="docs-viz-file-footer">Hand it to <code>/impeccable</code>, <code>/impeccable craft</code>, or any implementation flow.</div>
  </div>
  <p class="docs-viz-caption">A shape brief is a compass, not a spec. It captures intent, not UI. Implementation skills read it before writing a line of code.</p>
</div>

## When to use it

`/impeccable shape` is where a feature starts. Before anyone writes code, before anyone argues about the hero treatment, before anyone picks a font. Use it to force a discovery conversation about purpose, users, content, and constraints, then capture the answers as a design brief the implementation skills can lean on.

Reach for it whenever a feature is about to start, a ticket is vague, or you catch yourself writing JSX to figure out what the product should be.

## How it works

Most AI-generated UIs fail not because of bad code, but because of skipped thinking. The model jumps to "here is a card grid" without asking "what is the user trying to accomplish". `/impeccable shape` inverts that order.

The skill runs a structured discovery interview in conversation. It will not write code during this phase. The questions cover:

- **Purpose and context**: what the feature is for, who uses it, what state of mind they are in
- **Content and data**: what is displayed, realistic ranges, edge cases, what is dynamic
- **Design goals**: the single most important thing, the intended feeling, reference examples
- **Constraints**: technical, content, accessibility, localization

You answer naturally. The skill asks follow-ups, not a form. At the end it produces a design brief: a structured artifact you can hand to `/impeccable` or any other implementation skill.

Note: if you want the full flow (discovery interview, then straight into building), use `/impeccable craft` instead. It runs `/impeccable shape` internally, then continues into implementation with visual iteration. `/impeccable shape` standalone is for when you want just the brief, so you can take it to whatever implementation approach you prefer.

## Try it

```
/impeccable shape a daily digest email preferences page
```

Expect a 5 to 10 question conversation. The skill asks things like "who is the person opening this, and are they already committed or still curious" and "what happens when the user has unsubscribed from everything, do we hide the feature or show something". You answer, and a brief materializes.

From there you can hand the brief to `/impeccable`, `/impeccable polish`, or any other skill. Or just use it as a reference while you build by hand.

## Pitfalls

- **Skipping it because it feels slow.** The interview is maybe 5 minutes. The rewrites you avoid are measured in hours.
- **Treating the brief as a spec.** It is a compass, not a checklist. It captures intent, not UI.
- **Answering with "standard" or "normal".** Specificity is the whole point. If a user is "rushed, on mobile, between meetings", say so. That changes everything downstream.
