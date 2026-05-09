> **Additional context needed**: existing motion conventions in codebase, `prefers-reduced-motion` support state, framework (Tailwind / vanilla CSS / CSS-in-JS).

Refine the quality of interactions that already exist. Not adding new animations — correcting bad timing, replacing accidental defaults, choreographing state changes that are currently abrupt. The Japanese concept of *kodawari*: meticulous attention to things that don't need to be there, that most users won't consciously notice, but whose absence you always feel.

The gap this fills: `animate` adds motion where there is none. `polish` fixes visual alignment and design-system drift. `delight` adds personality. `finesse` operates on *live interactions*, making the ones already there feel intentional.

---

## Register

**Brand**: Apply finesse broadly — entrance choreography, page-level transitions, and micro-interactions contribute to the voice. Motion is part of the design identity.

**Product**: Apply finesse at the interaction level, not the page level. Users are in a task; they don't wait for page-load choreography. Every interaction should give feedback; no interaction should feel jarring or unfinished.

---

## Scope

**Does**: timing, easing curves, entrance/exit choreography, micro-feedback, state quality (hover, focus, active, loading, empty), asymmetric enter/exit, prefers-reduced-motion coverage.

**Does not**: layout, typography, color, visual hierarchy — delegate those to `/impeccable layout`, `/impeccable typeset`, `/impeccable colorize`.

---

## Soft Dependencies

Before starting, check if any of these outputs exist in the session or codebase:

- **critique report**: use flagged "confusing" or "jarring" areas to prioritize patterns.
- **audit report**: use a11y gaps (missing focus-visible, no reduced-motion) to drive Phase 2 order.
- **polish notes**: avoid re-touching areas already polished; focus on what polish left.

If none exist, proceed to Phase 1 with no prior context.

---

## Hard Block: `prefers-reduced-motion`

**Never commit a motion pattern without a reduced-motion fallback.** Before applying any pattern from Phase 2, verify the target file has or will receive:

```css
@media (prefers-reduced-motion: reduce) {
  /* fallback: typically opacity-only, no spatial movement */
}
```

In Tailwind: `motion-reduce:transition-none`, `motion-reduce:scale-100`, `motion-reduce:translate-y-0`.

Vestibular disorders affect ~35% of adults over 40. This is not optional. If the file lacks reduced-motion support and adding the patterns would introduce spatial movement, add the media query before applying the pattern.

---

## Phase 1: Audit

Catalog all state changes in the target. Do not skip this phase. Applying patterns without an audit is how you introduce motion debt instead of removing it.

### What to look for

| Signal | What it means |
|--------|--------------|
| `transition-all` | Grabs everything including layout — replace with explicit properties |
| `ease`, `linear`, no easing | CSS defaults that don't feel intentional |
| Instant show/hide (`display: none` toggle, conditional render) | Abrupt — needs exit/entry |
| `ease-in-out` on both enter and exit | Symmetric — should be asymmetric |
| Duration > 500ms on feedback | Laggy — users will feel the wait |
| Duration < 80ms on reveals | Too fast to track — increase to 150ms |
| Missing `active:` state on interactive elements | No press feedback |
| Missing `focus-visible:` | Keyboard users see nothing |
| Bounce or elastic easing | Dated; remove |
| Same duration on enter and exit | Exit should be ~75% of enter |
| No `prefers-reduced-motion` coverage | Accessibility violation |

### Audit output format

Produce a prioritized list before applying anything:

```
FINESSE AUDIT — [ComponentName]

P0 (blocking): transition-all in 3 places, no prefers-reduced-motion
P1 (major):    instant show/hide on dropdown, no active: state on CTA button
P2 (minor):    symmetric enter/exit on modal (both 300ms ease-in-out)
P3 (polish):   hover lift missing on clickable cards
```

Apply P0 before P1, P1 before P2. Never apply everything at once — one pattern at a time, diff stays small.

---

## Phase 2: Apply

### How to read each pattern

Every pattern below has the same structure:
- **When**: use this pattern.
- **When not**: context where this pattern is wrong.
- Short reasoning sentence (the *why*).
- **Before / After**: worked code diff.
- **Signal**: what correct feels like.

---

### Family 1: Exits

#### Chain-of-thought: how to decide which exit pattern

Before picking a pattern, answer in order:

1. **Does the element occupy flow space, or float above content?**
   - Occupies flow (chip, tag, list item, inline error) → choreographed exit (opacity then height collapse).
   - Floats (tooltip, popover, toast, modal backdrop) → fade only (no height collapse needed).

2. **Is the exit triggered by user action or external state change?**
   - Direct action (user clicked Remove) → start immediately, aggressive ease-in (short).
   - External change (timeout, server push) → gentle ease-in, give the eye time to track.

3. **Is there a matching entry?**
   - Yes → exit is ~75% of entry duration (from motion-design.md rule).
   - No → use 150ms as default.

4. **prefers-reduced-motion?** → Always provide opacity-only fallback.

If you can't answer 1–3 without guessing, read the component context before applying.

---

#### Choreographed exit (for flow-occupying elements)

**When**: removing chips, tags, list items, inline alerts, validation messages — elements that occupy space in the document flow.

**When not**: overlays, tooltips, popovers, toasts that float over content.

**Reasoning**: disappearing without collapsing leaves a gap that jumps — the element vanishes but space doesn't. Content around it lurches. Opacity fades first so the user sees the intent; then height collapses so surrounding content slides smoothly.

**Before** (typical AI output):
```tsx
// v-if / conditional render — element just vanishes
{isVisible && <Chip>{label}</Chip>}
```

**After** (Vue example):
```vue
<Transition
  enter-active-class="transition-[opacity,max-height] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] overflow-hidden"
  enter-from-class="opacity-0 max-h-0"
  enter-to-class="opacity-100 max-h-[4rem]"
  leave-active-class="transition-[opacity,max-height] duration-150 ease-[cubic-bezier(0.7,0,0.84,0)] overflow-hidden"
  leave-from-class="opacity-100 max-h-[4rem]"
  leave-to-class="opacity-0 max-h-0"
>
  <Chip v-if="isVisible">{{ label }}</Chip>
</Transition>
```

**Diff commentary**:
- Opacity goes first (200ms enter, 150ms exit — asymmetric).
- Height collapse via `max-height` avoids animating `height: auto` directly.
- `overflow-hidden` prevents content peeking during collapse.
- Exit is 75% of enter duration (200 → 150ms).
- `ease-out-expo` on enter (starts fast, decelerates into place). `ease-in` on exit (starts slow, accelerates away).

**Signal**: element leaves, surrounding content shifts smoothly. User doesn't see a jump or a void.

---

#### Simple fade (for floating elements)

**When**: tooltips, popovers, dropdowns, toast notifications, modal backdrops.

**When not**: anything that occupies document flow — use choreographed exit instead.

**Reasoning**: floating elements don't affect surrounding layout, so height choreography adds complexity with no visual benefit.

**Before**:
```css
.tooltip { display: none; }
.tooltip.visible { display: block; }
```

**After** (Tailwind + data-state pattern):
```tsx
<div
  className="
    transition-opacity duration-150
    ease-[cubic-bezier(0.7,0,0.84,0)]
    data-[state=closed]:opacity-0
    data-[state=closed]:pointer-events-none
    data-[state=open]:opacity-100
    motion-reduce:transition-none
  "
  data-state={isOpen ? 'open' : 'closed'}
>
```

**Signal**: tooltip appears and disappears. Eye tracks it. No snap-in, no snap-out.

---

#### Collapse vertical (for accordions and expandable sections)

**When**: accordion panels, filter groups, validation error messages appearing/disappearing, details sections.

**When not**: items in a flat list that are being *removed* — use choreographed exit. This pattern is for height toggling on the same element.

**Reasoning**: `height: auto` can't be transitioned natively. Grid trick avoids JS measurement.

**After** (CSS-only):
```css
.expandable {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 250ms cubic-bezier(0.16, 1, 0.3, 1);
}

.expandable.open {
  grid-template-rows: 1fr;
}

.expandable-inner {
  overflow: hidden;
}

@media (prefers-reduced-motion: reduce) {
  .expandable { transition: none; }
}
```

**Signal**: section opens with content arriving from top. No sudden appearance, no measurement jank.

---

#### Slide-out directional (for drawers and side panels)

**When**: drawers, side panels, sheet overlays, off-canvas menus — elements with a clear origin edge.

**When not**: inline content, dialogs without a directional relationship.

**Reasoning**: direction must match the panel's origin. A right-side drawer slides right on exit. Sliding left on exit breaks spatial model.

**After** (right panel exit):
```css
.panel-enter {
  animation: slide-in-right 300ms cubic-bezier(0.16, 1, 0.3, 1);
}
.panel-exit {
  animation: slide-out-right 200ms cubic-bezier(0.7, 0, 0.84, 0);
}

@keyframes slide-in-right {
  from { transform: translateX(100%); opacity: 0; }
  to   { transform: translateX(0);    opacity: 1; }
}

@keyframes slide-out-right {
  from { transform: translateX(0);    opacity: 1; }
  to   { transform: translateX(100%); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .panel-enter, .panel-exit { animation: none; opacity: 1; }
}
```

**Signal**: panel arrives from its source, leaves toward its source. Spatial model is consistent.

---

### Family 2: Entries

#### Chain-of-thought: how to decide which entry pattern

1. **Is this a list of items or a single element?**
   - List of items → stagger (20–40ms per item, max 6–8 items staggered).
   - Single element → fade-in or snap-in depending on context.

2. **Does the element appear because of a user action or because data loaded?**
   - User action (opened a dropdown, expanded a panel) → snap-in (scale + opacity, snappy).
   - Data loaded (search results, list items rendered) → stagger fade.
   - Route change → fade-in or dissolve depending on register.

3. **Is there a corresponding exit?**
   - Yes → enter is the inverse ease (exit ease-in → enter ease-out), ~33% longer than exit.

4. **prefers-reduced-motion?** → fade only, no spatial movement.

---

#### Stagger (for lists of items)

**When**: search results, card grids, permission lists, tag collections, notification feeds.

**When not**: tables with >10 rows (fatigue), single-item reveals, page-level content.

**Reasoning**: stagger reveals the list as a set with direction, not a batch dump. User perceives structure.

**Before**:
```tsx
{items.map(item => <Card key={item.id} data={item} />)}
```

**After** (Tailwind + CSS custom property):
```tsx
{items.map((item, i) => (
  <Card
    key={item.id}
    data={item}
    className="animate-fade-in-up motion-reduce:animate-none"
    style={{ '--i': i } as React.CSSProperties}
  />
))}
```

```css
@keyframes fade-in-up {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.animate-fade-in-up {
  animation: fade-in-up 200ms cubic-bezier(0.16, 1, 0.3, 1) both;
  animation-delay: calc(var(--i, 0) * 30ms);
}
```

**Diff commentary**:
- `--i` custom property drives stagger delay without JS.
- 30ms per item × 8 items = 240ms total. Cap staggered count at 8; items 9+ appear simultaneously.
- `both` fill mode: element starts in `from` state (opacity 0), ends in `to` (no snap-back).
- `8px` translateY: subtle. More than 12px and it looks like a slide; less than 4px and it's imperceptible.

**Signal**: list arrives with direction and rhythm. Not a screen of cards materializing at once.

---

#### Snap-in (for triggered overlays)

**When**: dropdowns, popovers, context menus, dialogs — elements that appear in response to a direct user action.

**When not**: list items, page content, passive notifications.

**Reasoning**: snap-in confirms the user's action. The element must arrive fast — if it's slower than ~200ms, users wonder if the action registered.

**After** (Tailwind):
```tsx
<Popover
  className="
    origin-top
    data-[state=open]:animate-scale-in
    data-[state=closed]:animate-scale-out
    motion-reduce:data-[state=open]:animate-none
    motion-reduce:data-[state=closed]:animate-none
  "
>
```

```css
@keyframes scale-in {
  from { opacity: 0; transform: scale(0.95); }
  to   { opacity: 1; transform: scale(1); }
}

@keyframes scale-out {
  from { opacity: 1; transform: scale(1); }
  to   { opacity: 0; transform: scale(0.95); }
}

.animate-scale-in  { animation: scale-in  150ms cubic-bezier(0.16, 1, 0.3, 1); }
.animate-scale-out { animation: scale-out 100ms cubic-bezier(0.7,  0, 0.84, 0); }
```

**Diff commentary**:
- Scale from 0.95 (not 0.5, not 0.8) — subtle enough to feel physical, not theatrical.
- Exit is 100ms (vs 150ms enter) — faster exit = snappier feel.
- `origin-top` anchors scale to origin point. Use `origin-top-left` for right-edge dropdowns.
- No bounce, no elastic.

**Signal**: dropdown appears. User doesn't register "an animation happened" — they register "it's there."

---

### Family 3: Feedback

#### Chain-of-thought: how to decide which feedback pattern

1. **What is the user doing?**
   - Pressing a button → press feedback.
   - Toggling a switch or checkbox → toggle snap.
   - Hovering a card or navigable item → hover lift (only if truly clickable).
   - Completing an action (save, copy, delete) → ripple/confirmation.

2. **How fast must feedback be?**
   - Press feedback: ≤100ms (user perceives it as simultaneous with tap).
   - Toggle snap: 150ms (spring feel).
   - Confirmation ripple: 600ms hold (enter + hold + exit ≈ 1s total).

3. **Is this touch or mouse?**
   - Touch: hover states don't apply. Active states + haptic (where available) do.
   - Mouse: hover states are the primary affordance signal.

---

#### Press feedback (for all interactive buttons)

**When**: every primary button, secondary button, IconButton, CTA, submit.

**When not**: links in prose, dense list items, pagination controls.

**Reasoning**: 80ms is the threshold of perceived simultaneity. Press feedback below 100ms feels like a physical button. Above 200ms, users wonder if the tap registered.

**Before** (typical AI output):
```tsx
<button className="bg-blue-500 hover:bg-blue-600 transition-all duration-200">
  Submit
</button>
```

**After**:
```tsx
<button className="
  bg-blue-500
  hover:bg-blue-600
  active:scale-[0.97] active:bg-blue-700
  transition-[transform,background-color]
  duration-100
  ease-[cubic-bezier(0.16,1,0.3,1)]
  motion-reduce:transition-none
  motion-reduce:active:scale-100
">
  Submit
</button>
```

**Diff commentary**:
- `transition-all` → `transition-[transform,background-color]` — prevents accidental capture of layout properties (margin, padding, border-radius).
- `active:scale-[0.97]` — 3% reduction. More = theatrical; less = imperceptible.
- `duration-100` — micro-interaction. Near the 80ms threshold of perceived simultaneity.
- `active:bg-blue-700` — color darkens on press, reinforcing press state visually.
- Reduced-motion: no scale, instant color transition.

**Signal**: user presses the button and doesn't consciously think about animation. But remove it and they notice something's missing.

---

#### Toggle snap (for switches and checkboxes)

**When**: toggle switches, checkboxes that confirm a state change (not selection in a list).

**When not**: bulk selection checkboxes in tables (too many state changes; stagger would be overwhelming).

**Reasoning**: a switch communicates binary state — it should *snap* to position, not drift. The motion is faster than a reveal and uses a different easing.

**After** (CSS custom switch):
```css
.switch-thumb {
  transition: transform 150ms cubic-bezier(0.65, 0, 0.35, 1);
}

.switch:checked .switch-thumb {
  transform: translateX(20px);
}

@media (prefers-reduced-motion: reduce) {
  .switch-thumb { transition: none; }
}
```

**Signal**: switch snaps to new position. Feels like a physical toggle, not a slow slide.

---

#### Hover lift (for navigable cards)

**When**: cards or list items that navigate somewhere on click. The lift signals "this is clickable."

**When not**: dense list items (the lift becomes noise), non-navigable cards (misleads), text links.

**Reasoning**: shadow + micro-translate communicates "this element rises above the surface" — a physical affordance for clickability.

**After**:
```tsx
<Card className="
  transition-[transform,box-shadow]
  duration-200
  ease-[cubic-bezier(0.16,1,0.3,1)]
  hover:-translate-y-0.5
  hover:shadow-md
  motion-reduce:hover:translate-y-0
  motion-reduce:hover:shadow-md
">
```

**Diff commentary**:
- `2px` translateY (`-translate-y-0.5`) — visible but not dramatic.
- `shadow-md` → one step up. Don't jump to `shadow-xl`; that's for modals.
- `motion-reduce`: keep the shadow (visual affordance), remove the translate (spatial movement).

**Signal**: user hovers a card and perceives "I can click this." Hover on non-navigable cards would be misleading — hence the "when not."

---

#### Confirmation ripple (for completed actions)

**When**: copy-to-clipboard, save, send, upload complete, delete confirmation — one-shot actions where success isn't otherwise visible.

**When not**: high-frequency actions (typing completion, filter changes), destructive actions that need a confirmation step.

**Reasoning**: without a ripple, the user doesn't know the action registered. With a ripple, the success state announces itself and fades — ~1s total (enter + confirm + exit) feels right: long enough to read, short enough not to linger.

**After** (React with a temporary state):
```tsx
const [copied, setCopied] = useState(false);

const handleCopy = () => {
  navigator.clipboard.writeText(value);
  setCopied(true);
  setTimeout(() => setCopied(false), 600);
};

<button onClick={handleCopy} className="relative overflow-hidden">
  <span className={`
    transition-[opacity,transform] duration-200
    ${copied ? 'opacity-0 scale-75' : 'opacity-100 scale-100'}
  `}>Copy</span>
  <span className={`
    absolute inset-0 flex items-center justify-center
    transition-[opacity,transform] duration-200
    text-green-600
    ${copied ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}
  `}>✓ Copied</span>
</button>
```

**Signal**: user clicks Copy. "✓ Copied" appears briefly and fades. No toast needed for inline confirmations.

---

### Family 4: Coordinated Sequences

#### Chain-of-thought: how to sequence multi-element transitions

When multiple elements change together, they should not change simultaneously.

**Rule**: lead with context, follow with content.
- Context elements (backdrop, overlay, container) appear first.
- Content elements (modal body, panel content, list items) appear second, with a 50–80ms delay.

Why: showing content before context gives the user nothing to orient against. The container arriving first establishes *where* content will be before it appears.

**Rule for exits**: reverse the order.
- Content exits first (the important part is leaving).
- Context (backdrop, container) exits after a 50ms delay.

---

#### Backdrop before content (modal entry/exit)

**When**: any overlay with a backdrop (modal, dialog, sheet).

**When not**: overlays without backdrop (tooltips, popovers).

**After**:
```tsx
// Backdrop — 150ms
<div className="
  fixed inset-0 bg-black/50
  data-[state=open]:animate-fade-in
  data-[state=closed]:animate-fade-out
  motion-reduce:data-[state=open]:opacity-50
  motion-reduce:data-[state=closed]:opacity-0
" />

// Content — 200ms, 50ms delay
<div className="
  fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
  data-[state=open]:animate-scale-in
  data-[state=closed]:animate-scale-out
  motion-reduce:data-[state=open]:animate-none
" style={{ animationDelay: '50ms' }} />
```

**Signal**: backdrop arrives. Eye adjusts. Modal content arrives into that context. Feels staged, not dumped.

---

#### Skeleton → content (crossfade without layout shift)

**When**: any component that loads async data where the skeleton has a fixed shape.

**When not**: streaming content, variable-height content where exact skeleton height is unknown.

**Reasoning**: the skeleton and real content must have identical dimensions. If they don't, the crossfade causes layout shift. This is worse than no animation.

**After**:
```tsx
<div className="relative">
  {/* Skeleton — fades out when data arrives */}
  <div className={`
    absolute inset-0
    transition-opacity duration-200
    ${isLoaded ? 'opacity-0 pointer-events-none' : 'opacity-100'}
    motion-reduce:transition-none
  `}>
    <SkeletonCard />
  </div>

  {/* Content — fades in when data arrives */}
  <div className={`
    transition-opacity duration-200
    ${isLoaded ? 'opacity-100' : 'opacity-0'}
    motion-reduce:transition-none
  `}>
    <RealCard data={data} />
  </div>
</div>
```

**Critical**: `absolute inset-0` on skeleton means it never shifts layout. Both layers occupy the same space. `pointer-events-none` on the exiting skeleton prevents click interception.

**Signal**: content loads. Users sees a smooth crossfade, not a height jump.

---

#### Loading inline (button holds its width)

**When**: any button that triggers an async action and shows a loading state.

**When not**: buttons that navigate synchronously.

**Reasoning**: a button changing size during loading shifts layout. If the CTA is 180px, it should be 180px whether it shows a label or a spinner.

**After**:
```tsx
<button
  disabled={isLoading}
  className="min-w-[120px] h-10 transition-colors duration-150"
>
  {isLoading ? (
    <Spinner className="mx-auto h-4 w-4 animate-spin motion-reduce:animate-none" />
  ) : (
    label
  )}
</button>
```

**Signal**: user clicks. Spinner appears. Button doesn't move. The rest of the form doesn't jump.

---

#### Error shake (validation feedback)

**When**: form submission with validation errors.

**When not**: on every keystroke (too much). Only on submission or on blur-and-resubmit.

**Reasoning**: shake is universal language for "wrong." 3 cycles, 4px amplitude, 300ms total.

**After**:
```css
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20%, 60%  { transform: translateX(-4px); }
  40%, 80%  { transform: translateX( 4px); }
}

.field-error {
  animation: shake 300ms ease-in-out;
}

@media (prefers-reduced-motion: reduce) {
  .field-error {
    animation: none;
    outline: 2px solid red;
    outline-offset: 2px;
  }
}
```

**Signal**: user submits invalid form. Field shakes briefly. Error message expands. User knows exactly which field failed without reading an error banner.

---

### Family 5: Data Transitions

#### Animated number (counters and metrics)

**When**: dashboards, counters, numeric badges that update — cases where the delta between old and new value is semantically meaningful.

**When not**: input fields, IDs, codes, any number that isn't a meaningful quantity.

```ts
// Minimal JS tween (no library needed)
function tweenNumber(from: number, to: number, el: HTMLElement, duration = 600) {
  const start = performance.now();
  const update = (now: number) => {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 4); // ease-out-quart
    el.textContent = String(Math.round(from + (to - from) * eased));
    if (t < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}
```

**Reduced-motion**: check `matchMedia('(prefers-reduced-motion: reduce)')` — if true, set value immediately.

**Signal**: metric changes from 1,240 to 1,312. User sees the number counting up. Communicates live data, not a static snapshot.

---

#### Content swap (value changes in place)

**When**: a displayed value changes (user selects a variant, locale changes a price, status updates).

**When not**: values changing faster than 250ms (would look flickery).

**After**:
```css
.value-swap-leave { animation: fade-out-up 80ms cubic-bezier(0.7, 0, 0.84, 0) both; }
.value-swap-enter { animation: fade-in-up  80ms cubic-bezier(0.16, 1, 0.3, 1) both; }

@keyframes fade-out-up {
  to { opacity: 0; transform: translateY(-4px); }
}

@keyframes fade-in-up {
  from { opacity: 0; transform: translateY(4px); }
}

@media (prefers-reduced-motion: reduce) {
  .value-swap-leave, .value-swap-enter { animation: none; }
}
```

**Signal**: price changes from $12 to $15. Old value slides up and fades; new value slides up and arrives. User sees the change clearly.

---

#### Empty state transition

**When**: a list transitions from populated to empty (items deleted, filter returns no results).

**When not**: initial page load into an empty state — that's onboard territory.

**After**:
```tsx
// import { AnimatePresence, motion } from 'framer-motion';
// import type { CSSProperties } from 'react';

// Items exit with stagger, then empty state enters.
// ListItem and EmptyState must be motion.* components (or wrapped in motion.div)
// with exit props so AnimatePresence can animate them out.
// CSS-only alternative: apply the stagger pattern from Family 2 and v-if the empty state.
const isEmpty = items.length === 0;

<AnimatePresence>
  {items.map((item, i) => (
    <motion.li
      key={item.id}
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0, transition: { delay: i * 0.03 } }}
      exit={{ opacity: 0, y: -8 }}
    >
      <ListItem data={item} />
    </motion.li>
  ))}
  {isEmpty && (
    <motion.div
      key="empty"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="motion-reduce:transition-none"
    >
      <EmptyState />
    </motion.div>
  )}
</AnimatePresence>
```

**Signal**: user deletes last item. Items exit with stagger. Empty state fades in. User sees a narrative: "items gone → now empty." No jarring teleport.

---

### Family 6: Easing Quality

#### Audit existing curves

**When**: always — this is the first thing to fix before any other pattern.

**What to search for and replace**:

| Replace | With | Reason |
|---------|------|--------|
| `transition-all` | `transition-[transform,opacity]` or explicit properties | Catches layout properties accidentally |
| `ease` (default) | `cubic-bezier(0.16, 1, 0.3, 1)` (expo-out) | Default ease is a compromise, not a choice |
| `ease-linear` | Remove or use only for infinite loops (spinners) | Linear motion looks mechanical |
| `ease-in-out` on enter | `ease-out` variant | Enters should decelerate into rest |
| `ease-in-out` on exit | `ease-in` variant | Exits should accelerate away |
| Same duration for enter and exit | Exit = 75% of enter | Exits should feel snappier |
| `transition: all 300ms bounce` | `cubic-bezier(0.16, 1, 0.3, 1)` | Bounce easing looks dated |

---

#### Asymmetric enter/exit easing

**When**: any element with both an enter and exit animation.

**Reasoning**: objects entering our field of view decelerate as they settle (ease-out). Objects leaving accelerate away (ease-in). Symmetric easing (same curve on both) ignores physics and feels flat.

**Canonical curves** (re-use from motion-design.md):
```css
--ease-enter: cubic-bezier(0.16, 1, 0.3, 1);   /* expo-out: confident deceleration */
--ease-exit:  cubic-bezier(0.7,  0, 0.84, 0);   /* expo-in:  accelerates away */
--ease-toggle: cubic-bezier(0.65, 0, 0.35, 1);  /* in-out: for state toggles only */
```

---

#### Duration by distance

**When**: any element that moves spatially (slides, translates, expands).

| Motion distance | Duration |
|----------------|----------|
| Micro (button press, icon hover) | 80–100ms |
| Short (tooltip, badge) | 150ms |
| Medium (dropdown, popover, modal enter) | 200–250ms |
| Long (drawer, full-panel) | 300–350ms |
| Page-level (route change) | 350–500ms |

An element traveling 8px should not take 500ms. An element traveling 400px should not take 100ms.

---

## Worked Example

A full audit-to-application walkthrough on a `NotificationBanner` component.

### Starting point

```tsx
// NotificationBanner.tsx — before finesse
export function NotificationBanner({ message, type, onClose }: Props) {
  return (
    <div className={`
      flex items-center gap-3 p-4 rounded-lg border
      transition-all duration-300
      ${type === 'error' ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'}
    `}>
      <Icon type={type} />
      <p>{message}</p>
      <button onClick={onClose} className="ml-auto hover:opacity-70">
        <X size={16} />
      </button>
    </div>
  );
}
```

### Phase 1 Audit

```
FINESSE AUDIT — NotificationBanner

P0: transition-all — grabs border, padding, border-radius on color change; risk of layout reflow
P0: no prefers-reduced-motion coverage anywhere
P1: onClose triggers instant removal — no exit animation
P1: close button has no active: state, only opacity hover (no press feedback)
P1: focus-visible ring missing on close button
P2: ease default (not intentional) on transition
P3: banner entrance is instant (appears with no enter)
```

### Decision: what to apply first

1. P0: Replace `transition-all` with `transition-[background-color,border-color]`.
2. P0: Add `prefers-reduced-motion` wrapper.
3. P1: Wrap in `<Transition>` for choreographed exit (it occupies flow space).
4. P1: Add `active:scale-[0.97]` + `focus-visible:ring-2` to close button.
5. P3: Add fade-in entry.

### After finesse

```tsx
// import { Transition } from '@headlessui/react'; // or use <Transition> from your framework
// NotificationBanner.tsx — after finesse
export function NotificationBanner({ message, type, isVisible, onClose }: Props) {
  return (
    <Transition
      show={isVisible}
      enter="transition-[opacity,max-height] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] overflow-hidden"
      enterFrom="opacity-0 max-h-0"
      enterTo="opacity-100 max-h-24"
      leave="transition-[opacity,max-height] duration-150 ease-[cubic-bezier(0.7,0,0.84,0)] overflow-hidden"
      leaveFrom="opacity-100 max-h-24"
      leaveTo="opacity-0 max-h-0"
    >
      <div className={`
        flex items-center gap-3 p-4 rounded-lg border
        transition-[background-color,border-color] duration-200
        ease-[cubic-bezier(0.16,1,0.3,1)]
        motion-reduce:transition-none
        ${type === 'error' ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'}
      `}>
        <Icon type={type} />
        <p>{message}</p>
        <button
          onClick={onClose}
          className="
            ml-auto
            hover:opacity-70
            active:scale-[0.97]
            transition-[transform,opacity] duration-100
            ease-[cubic-bezier(0.16,1,0.3,1)]
            focus-visible:ring-2 focus-visible:ring-offset-1
            focus-visible:ring-current rounded
            motion-reduce:transition-none
            motion-reduce:active:scale-100
          "
          aria-label="Dismiss notification"
        >
          <X size={16} />
        </button>
      </div>
    </Transition>
  );
}
```

### Verification checklist

- [ ] Click dismiss: banner fades out while collapsing height. Surrounding content slides up smoothly.
- [ ] Tab to close button: focus ring visible.
- [ ] Press close button: 3% scale-down visible on active.
- [ ] Switch `type` prop while visible: color transitions, no layout jump.
- [ ] Set OS reduced-motion: no spatial movement. Opacity crossfades acceptable. Color change instant.
- [ ] Banner re-appears (new notification): fade-in entry works.

---

## NEVER

- Apply `transition-all` — always be explicit about which properties to transition.
- Use bounce or elastic easing — they draw attention to the animation, not the content.
- Animate `width`, `height`, `top`, `left`, `margin` directly — use transform, max-height, grid-template-rows, or FLIP.
- Apply all patterns at once — one diff at a time. Motion debt compounds; so does motion noise.
- Skip prefers-reduced-motion — this is an a11y violation, not a nice-to-have.
- Add hover states that also fire on touch — `@media (hover: hover)` guards hover-only affordances.
- Use the same duration on enter and exit — exit is ~75% of enter.

When the interactions feel intentional without the user knowing why, hand off to `/impeccable polish` for the final pass.
