---
tagline: "Make designs work across screens, devices, and contexts without amputating features."
---

## When to use it

`/impeccable adapt` is for taking a design built for one context and making it work in another. Mobile from desktop, tablet from mobile, print from web, embedded from standalone, email from dashboard. Reach for it when the source design is solid but falls apart at other breakpoints, on touch, or in a different container.

Not for building responsive from scratch. For that, start with `/impeccable` and shape the layout responsive-first. Adapt is for the "we never thought about mobile" backfill.

## How it works

The skill works through four dimensions of contextual fit:

1. **Breakpoints and fluid layout**: collapse multi-column to single, adjust clamp ranges, introduce new breakpoints where the design genuinely breaks.
2. **Touch targets**: minimum 44px hit areas, sufficient spacing between adjacent targets, larger tap zones than visual bounds where needed.
3. **Navigation patterns**: desktop sidebars become mobile bottom nav or slide-outs, dense toolbars collapse into menus, hover states get touch equivalents.
4. **Content priority**: decide what must be visible, what can collapse into disclosures, what can be removed entirely for that context.

The non-negotiable rule: adapt, do not amputate. Critical functionality cannot disappear on mobile just because it is inconvenient. Find a way to fit it, redesign the interaction, or reconsider whether it was really critical on desktop.

## Try it

```
/impeccable adapt the settings page for mobile
```

Expected changes:

- Three-column grid becomes single column with section headers acting as sticky dividers
- Sidebar nav moves to a horizontal scroller above the content
- Toggles gain 8px vertical padding so they meet 44px touch targets
- Inline help text moves to tap-to-reveal, not hover
- The "Danger zone" section expands fully on mobile instead of collapsing, because it contains irreversible actions and we want users to see them clearly

## Pitfalls

- **Amputating features.** If the mobile version hides things the desktop version can do, that is a regression, not an adaptation. Fight for the feature.
- **Treating mobile as "smaller desktop".** Mobile is a different context: thumbs, interruption, short sessions. Adapt to the context, not to the viewport width.
- **Skipping `/impeccable harden` afterward.** Responsive layouts reveal edge cases. Run hardening after adapt to catch the ones that only show up at 320px.
