> **Additional context needed**: brand register (consumer SaaS vs institutional), input modality (touch vs mouse primary), whether audio is appropriate for this context.

Add game-feel to interactions that already work. *Juicy*, in game design, means every action has multiple layers of feedback — the interface is generous in what it gives back. `finesse` makes interactions intentional; `juicy` makes them satisfying.

The distinction matters: a well-timed button press is finesse. The same button press with a cursor that acknowledges the drag, a drop zone that glows when valid, and a micro-click sound on confirm — that's juicy. It's a layer above polish, not a replacement.

**Context gate**: before applying any pattern from this command, assess:
- Is this SaaS / consumer product or institutional / financial / medical?
- Is the primary modality touch or mouse?
- Does the brand brief mention sound or haptics?

Institutional contexts (government portals, banking, medical records, legal software) should default to `/impeccable finesse` only. Do not add sound, custom cursors, or drag choreography without an explicit brief that invites it.

---

## Register

**Brand**: juicy is at home here — cursor customization, sound design, scroll choreography, and ambient awareness all contribute to brand voice. Apply broadly.

**Product**: apply juicy at specific high-value moments, not globally. Completion states, drag-and-drop flows, interactive data visualizations. Productivity tools should be fast and quiet everywhere else.

---

## Soft Pre-requisite

Run `/impeccable finesse` before `/impeccable juicy`. Juicy layers *on top of* correct timing and easing — adding drag choreography to a button that still uses `transition-all` creates an incoherent experience. Fix the foundation first.

---

## Hard Blocks

1. **prefers-reduced-motion**: any pattern adding spatial motion requires a fallback (same rule as finesse).
2. **Sound**: all audio patterns require: (a) user opt-in or system sound setting check, (b) AudioContext not `<audio>`, (c) volume ≤ -18dBFS, (d) global mute path.
3. **Custom cursor**: never override cursor on text content, inputs, or textareas — this breaks UX.

---

## Phase 1: Audit

Catalog gaps in the following categories before applying anything:

| Area | What to look for |
|------|-----------------|
| Cursor | Draggable elements without `cursor-grab`, resizable panels without `cursor-col-resize`, copyable elements without `cursor-copy`, disabled elements with `cursor-default` instead of `cursor-not-allowed` |
| Drag | Drag handlers using browser-default ghost image, no drop zone visual feedback, no reorder animation on list sort |
| Scroll | Carousels without `scroll-snap`, long horizontal lists without snap, scroll-behavior not set, sticky headers that change height without transition |
| Awareness | Missing `prefers-color-scheme` theme transition (flash instead of crossfade), missing `prefers-contrast` handling, hover states not guarded by `@media (hover: hover)` |
| Selection | `::selection` using browser default (blue), range inputs with default thumb, search results without highlight animation |
| Keyboard | Missing shortcut echo, focus ring that's correct but visually generic, no tab indicator on complex nav |
| Sound | High-value interactions (toggle, confirm, delete) with no audio layer — note only if consumer/SaaS context |

Produce a prioritized list, same P0–P3 format as finesse.

---

## Phase 2: Apply

---

### Family 1: Cursor

#### Chain-of-thought: cursor decisions

1. **What is the user about to do?**
   - Grab and drag → `cursor-grab`, `cursor-grabbing` on active.
   - Resize a panel → `cursor-col-resize` or `cursor-row-resize`.
   - Click to zoom/expand → `cursor-zoom-in`.
   - Copy content → `cursor-copy`.
   - Interact with something currently unavailable → `cursor-not-allowed`.

2. **Is this a text area, input, or selectable text?** → Do not override cursor. Browser defaults are correct here.

3. **Is this a custom SVG cursor?** → Use only if it communicates something the system cursors can't (e.g., a canvas tool). Brand-logo cursors are noise.

---

#### Drag affordance cursors

**When**: any draggable element — sortable list items, kanban cards, resize handles, panel splitters.

**When not**: text, inputs, non-interactive elements.

**After**:
```tsx
// Sortable list item
<li
  className="
    cursor-grab
    active:cursor-grabbing
    select-none
  "
  draggable
>
```

```css
/* Panel resize handle */
.resize-handle {
  cursor: col-resize;
  user-select: none;
}

/* When resizing is active */
body.resizing {
  cursor: col-resize;
  user-select: none;
}
```

**Diff commentary**:
- `select-none` prevents text selection during drag (the most common drag UX bug).
- Set `cursor-grabbing` on `body` during active drag — not just on the element — so cursor stays consistent if pointer moves off the element.
- `cursor-grab` on hover, `cursor-grabbing` on mousedown.

**Signal**: user hovers a draggable item and their hand cursor changes to a grab. No need to read documentation to know it's draggable.

---

#### Context-aware cursor vocabulary

```tsx
// Zoom-able image or map
<div className="cursor-zoom-in hover:cursor-zoom-in">

// Copyable token / code block
<code className="cursor-copy" onClick={handleCopy}>

// Disabled but visible (not hidden) control
<button disabled className="cursor-not-allowed opacity-50">

// Active painting or drawing tool
// cursor: url('./brush.svg') 8 8, crosshair;
// (hotspot at 8,8 = center of 16px icon)
```

**Signal**: cursor changes communicate affordance without tooltips. Users know what's interactive before they click.

---

### Family 2: Drag Choreography

#### Chain-of-thought: drag quality decisions

1. **What is being dragged?**
   - A sortable list item → ghost + drop preview + reorder animation.
   - A file into a drop zone → drop zone activation feedback.
   - A resizable panel splitter → cursor + no ghost (it's not detached).

2. **What does the drop zone need to communicate?**
   - Idle (nothing being dragged) → normal appearance.
   - Hovering with valid item → positive highlight (ring, background tint).
   - Hovering with invalid item → negative signal (different color, `cursor-no-drop`).
   - Dropped successfully → brief flash, then reorder animation.

3. **Is there a reorder animation?**
   - Yes → use FLIP or `View Transitions API` so displaced items slide to new positions.
   - No → items teleport — jarring.

---

#### Custom ghost element

**When**: any HTML5 drag-and-drop implementation where the browser default ghost (a semi-transparent copy) looks wrong.

**After** (suppress browser ghost, use custom):
```ts
const handleDragStart = (e: DragEvent, item: Item) => {
  // Suppress browser ghost
  const ghost = document.createElement('div');
  ghost.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
  document.body.appendChild(ghost);
  e.dataTransfer!.setDragImage(ghost, 0, 0);
  setTimeout(() => ghost.remove(), 0);

  // Show custom ghost (your styled element, following cursor via JS)
  setDragging(item);
};
```

```tsx
// Custom ghost follows pointer
{dragging && (
  <div
    className="
      fixed pointer-events-none z-50
      bg-white shadow-xl rounded-lg border border-gray-200
      scale-105 rotate-1 opacity-90
      transition-none
    "
    style={{ top: pointerY - 8, left: pointerX - 8 }}
  >
    <DragPreview item={dragging} />
  </div>
)}
```

**Signal**: dragged item lifts from surface, tilts slightly, follows cursor. Looks intentional, not like a browser screenshot.

---

#### Drop zone progressive feedback

**When**: any designated drop target (file upload, kanban column, list reorder zone).

**After**:
```tsx
<div
  className={`
    rounded-lg border-2 border-dashed p-4
    transition-[border-color,background-color] duration-150
    ${dragState === 'idle'     ? 'border-gray-200 bg-transparent' : ''}
    ${dragState === 'hovering' ? 'border-blue-400 bg-blue-50 scale-[1.01]' : ''}
    ${dragState === 'invalid'  ? 'border-red-300 bg-red-50' : ''}
    motion-reduce:transition-none
    motion-reduce:scale-100
  `}
>
```

**Three states required**: idle, hovering-valid, hovering-invalid. A drop zone that only changes on valid hover misses the feedback opportunity on invalid items.

---

#### Reorder animation (FLIP)

**When**: sortable lists where items slide to new positions when one is moved.

**Reasoning**: without reorder animation, the list appears to teleport. With it, users see spatial continuity — where each item came from and where it's going.

```ts
// FLIP: First, Last, Invert, Play
function animateReorder(listEl: HTMLElement) {
  // First: snapshot positions
  const first = new Map<string, DOMRect>();
  listEl.querySelectorAll('[data-id]').forEach(el => {
    first.set(el.getAttribute('data-id')!, el.getBoundingClientRect());
  });

  // (DOM update happens here — React re-renders with new order)
  requestAnimationFrame(() => {
    // Last: measure new positions
    listEl.querySelectorAll('[data-id]').forEach(el => {
      const id = el.getAttribute('data-id')!;
      const last = el.getBoundingClientRect();
      const prev = first.get(id);
      if (!prev) return;

      // Invert
      const dy = prev.top - last.top;
      if (dy === 0) return;

      // Play
      el.animate(
        [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
        { duration: 250, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
      );
    });
  });
}
```

**Reduced-motion**: check `matchMedia('(prefers-reduced-motion: reduce)')` — skip the animation, let items teleport.

**Signal**: user drops item. Displaced items slide to their new positions. No teleport.

---

### Family 3: Scroll

#### scroll-snap (for carousels and horizontal lists)

**When**: image carousels, horizontal card strips, mobile-style navigation, tab bars that scroll.

**When not**: long vertical lists, data tables, free-form scroll areas.

**After**:
```css
.carousel {
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scrollbar-width: none; /* Firefox */
  -webkit-overflow-scrolling: touch;
}

.carousel::-webkit-scrollbar {
  display: none;
}

.carousel-item {
  scroll-snap-align: start;
  flex-shrink: 0;
}

@media (prefers-reduced-motion: reduce) {
  .carousel { scroll-behavior: auto; }
}
```

**Signal**: user swipes carousel. Items snap to grid. No partial views between items.

---

#### Sticky header with scroll transform

**When**: app headers or nav bars that should compress or change character on scroll.

**When not**: headers on content pages where the header should remain fully visible.

**After**:
```tsx
const { scrollY } = useScroll();
const headerHeight = useTransform(scrollY, [0, 80], ['5rem', '3rem']);
const shadowOpacity = useTransform(scrollY, [0, 40], [0, 1]);

<motion.header
  style={{ height: headerHeight }}
  className="sticky top-0 z-10 bg-white transition-shadow"
>
  <motion.div
    style={{ opacity: shadowOpacity }}
    className="absolute inset-x-0 bottom-0 h-px bg-black/10"
  />
```

**Reduced-motion**: use a single `ScrollObserver` to add a class when scrolled past threshold — apply shadow only, no height change.

**Signal**: page scrolls. Header compresses. Shadow appears. User knows they're no longer at the top without looking for a scroll indicator.

---

### Family 4: Awareness

#### Hover guard (touch devices)

**When**: any component with `:hover` styles.

**Reasoning**: touch devices fire `mouseover` on tap, then linger. A card that hover-lifts on touch stays lifted permanently. This is the most common cross-device polishing miss.

**After**:
```css
/* Only apply hover effects when hover is the primary input */
@media (hover: hover) {
  .card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.12);
  }
}

/* Touch-specific tap feedback instead */
@media (hover: none) {
  .card:active {
    transform: scale(0.98);
    transition: transform 80ms;
  }
}
```

**Signal**: card hover works on desktop. On mobile, tap gives press feedback instead of a stuck hover state.

---

#### Theme crossfade (no flash on color-scheme change)

**When**: any app supporting both light and dark mode via `prefers-color-scheme` or a user toggle.

**Reasoning**: switching themes without a transition causes an abrupt flash. A 200ms crossfade turns a jarring moment into a smooth state change.

**After** (user-toggled theme):
```css
:root {
  /* All color tokens go here */
  transition: background-color 200ms ease-out, color 200ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  :root { transition: none; }
}
```

**For system-level changes** (`prefers-color-scheme`): CSS transitions don't fire on media query changes — use a brief JS-added class to enable transitions only when theme toggle is triggered by user.

**Signal**: user switches theme. Colors dissolve to new palette. No flash. No jank.

---

#### prefers-contrast awareness

**When**: any app that should be usable by high-contrast users.

**What changes** at high contrast:
- Borders become more defined (increase border opacity or width).
- Shadows become borders (drop shadows are invisible in forced colors mode; replace with solid borders).
- Subtle backgrounds get removed (transparent surfaces become opaque).

```css
@media (forced-colors: active) {
  .card {
    border: 1px solid ButtonText;
    box-shadow: none;
  }
}

@media (prefers-contrast: more) {
  .muted-text { color: var(--color-text-primary); }
  .border-subtle { border-color: var(--color-border-strong); }
}
```

---

### Family 5: Selection and Text

#### Brand ::selection color

**When**: always — this is one of the most overlooked details in every codebase.

**Reasoning**: browser default blue selection doesn't match most brands. A selection in brand accent color costs one CSS rule and signals extreme attention to detail.

**After**:
```css
::selection {
  background-color: oklch(85% 0.15 var(--brand-hue) / 40%);
  color: inherit;
}
```

**Notes**:
- Keep opacity low (30–50%) so text contrast isn't affected.
- Use brand hue from design tokens, not a hardcoded hex.
- `color: inherit` prevents selection from changing text color.

**Signal**: user selects text. Selection is brand-colored. Nobody will say "nice selection color" — but they'll feel the product is made with intent.

---

#### Range input thumb

**When**: any `<input type="range">` that uses browser default styling.

**Reasoning**: browser-default range thumbs look like OS controls, not branded UI. Restyling them with consistent shape and animation signals ownership.

**After**:
```css
input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  border-radius: 2px;
  background: var(--color-surface-3);
  outline: none;
}

input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-accent);
  cursor: pointer;
  transition: transform 150ms cubic-bezier(0.16, 1, 0.3, 1),
              box-shadow 150ms;
}

input[type="range"]::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

input[type="range"]::-webkit-slider-thumb:active {
  transform: scale(1.1);
  box-shadow: 0 0 0 6px oklch(60% 0.2 var(--brand-hue) / 20%);
}

@media (prefers-reduced-motion: reduce) {
  input[type="range"]::-webkit-slider-thumb { transition: none; }
}
```

---

### Family 6: Keyboard Feedback

#### Shortcut echo

**When**: any keyboard shortcut that triggers an action without obvious visual confirmation.

**Reasoning**: sighted users who trigger shortcuts need feedback. Without it, they repeat the shortcut assuming it failed.

**After**:
```tsx
// Show a brief badge near the triggered element or globally
const [shortcutEcho, setShortcutEcho] = useState<string | null>(null);

const echo = (label: string) => {
  setShortcutEcho(label);
  setTimeout(() => setShortcutEcho(null), 600);
};

// On shortcut trigger:
echo('⌘K');

// Echo badge
{shortcutEcho && (
  <div className="
    fixed bottom-4 right-4
    bg-gray-900 text-white text-xs
    px-2 py-1 rounded
    font-mono
    animate-fade-in
    motion-reduce:animate-none
  ">
    {shortcutEcho}
  </div>
)}
```

---

#### Polished focus ring

**When**: any interactive element that currently has a generic browser focus ring or `outline: none`.

**Reasoning**: accessible focus ring ≠ beautiful focus ring. Both requirements can be satisfied simultaneously.

**After**:
```css
/* Global polished focus-visible */
:focus-visible {
  outline: none;
}

/* Components set their own ring */
.interactive:focus-visible {
  box-shadow:
    0 0 0 2px var(--color-background),   /* gap */
    0 0 0 4px var(--color-accent);       /* ring */
}

/* Inverse for dark surfaces */
.inverse .interactive:focus-visible {
  box-shadow:
    0 0 0 2px var(--color-surface-dark),
    0 0 0 4px oklch(90% 0.05 var(--brand-hue));
}
```

**Signal**: keyboard user tabs through UI. Every interactive element has a clean, brand-consistent ring. No generic blue, no invisible outline.

---

### Family 7: Sound (opt-in, contextual only)

**Context gate**: only apply this family when:
- Register is consumer SaaS, creative tool, productivity tool with brand permission for audio.
- Product brief mentions or implies sound as part of UX.
- NOT: institutional, financial, medical, government, enterprise admin, customer service tooling.

If unsure: ask. Default to no sound.

#### Architecture

```ts
// sound-manager.ts
class SoundManager {
  private context: AudioContext | null = null;
  private enabled: boolean;

  constructor() {
    // Respect OS sound setting
    this.enabled = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Note: no direct OS "mute" API — rely on app-level toggle
  }

  private getContext() {
    if (!this.context) {
      this.context = new AudioContext();
    }
    return this.context;
  }

  play(buffer: AudioBuffer, volume = 0.15) {
    if (!this.enabled) return;
    const ctx = this.getContext();
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.buffer = buffer;
    source.connect(gain).connect(ctx.destination);
    source.start();
  }

  setEnabled(v: boolean) { this.enabled = v; }
}

export const sounds = new SoundManager();
```

#### Sound vocabulary

| Interaction | Duration | Character |
|-------------|----------|-----------|
| Toggle on | 10–20ms | Short, bright, +pitch |
| Toggle off | 10–20ms | Short, muted, -pitch |
| Item confirmed/checked | 15–25ms | Soft click, resolved |
| Item removed/deleted | 20–30ms | Short descending |
| Notification arrive | 30–50ms | Distinct, not harsh |
| Error | 20–30ms | Low, brief |
| Success (major) | 80–150ms | Ascending, resolved |

**Volume target**: -18 to -24 dBFS. This is quiet — background noise level of a quiet room, not a notification.

```ts
// Generate a micro-sound with Web Audio API (no file needed)
function createClick(ctx: AudioContext, freq = 800, dur = 0.015): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / ctx.sampleRate;
    const env = Math.exp(-t * 300); // fast decay
    data[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.15;
  }
  return buf;
}
```

**Signal**: user toggles a switch. A brief, soft click confirms the action. Remove it and the toggle feels slightly less physical. Users who notice it usually describe it as "snappy" — not "sounds."

---

## Worked Example

A full audit-to-application walkthrough on a Kanban board card with drag-and-drop.

### Starting point

```tsx
// KanbanCard.tsx — before juicy
export function KanbanCard({ card, onDrag }: Props) {
  return (
    <div
      className="bg-white rounded border p-3 mb-2 cursor-pointer"
      draggable
      onDragStart={() => onDrag(card.id)}
    >
      <h3 className="text-sm font-medium">{card.title}</h3>
      <p className="text-xs text-gray-500">{card.assignee}</p>
    </div>
  );
}
```

### Phase 1 Audit

```
JUICY AUDIT — KanbanCard / KanbanColumn

P0: cursor-pointer on draggable element (should be cursor-grab)
P0: no cursor:grabbing on active drag state
P1: browser-default drag ghost (screenshot of card, semi-transparent)
P1: drop zone has no visual feedback on hover-with-item
P1: reorder has no animation — cards teleport to new positions
P2: select-none missing — text gets selected during drag
P3: ::selection color is browser default
```

### After juicy

```tsx
// KanbanCard.tsx — after juicy
export function KanbanCard({ card, isDragging, onDragStart }: Props) {
  return (
    <div
      className={`
        bg-white rounded border p-3 mb-2
        cursor-grab active:cursor-grabbing
        select-none
        transition-[transform,opacity,shadow] duration-150
        ${isDragging
          ? 'opacity-40 scale-95 rotate-1 shadow-lg'
          : 'opacity-100 scale-100 rotate-0 shadow-sm'
        }
        motion-reduce:transition-none
        motion-reduce:scale-100
        motion-reduce:rotate-0
      `}
      draggable
      onDragStart={onDragStart}
    >
      <h3 className="text-sm font-medium">{card.title}</h3>
      <p className="text-xs text-gray-500">{card.assignee}</p>
    </div>
  );
}

// KanbanColumn.tsx — after juicy
export function KanbanColumn({ cards, isDragOver, isInvalidTarget }: Props) {
  return (
    <div
      className={`
        flex flex-col gap-2 p-2 rounded-lg border-2 border-dashed min-h-[120px]
        transition-[border-color,background-color] duration-150
        ${isDragOver && !isInvalidTarget ? 'border-blue-400 bg-blue-50' : ''}
        ${isInvalidTarget ? 'border-red-300 bg-red-50' : ''}
        ${!isDragOver ? 'border-gray-200 bg-transparent' : ''}
        motion-reduce:transition-none
      `}
    >
      {cards.map((card, i) => (
        <KanbanCard
          key={card.id}
          card={card}
          data-id={card.id}
          isDragging={false}
        />
      ))}
    </div>
  );
}
```

### Verification checklist

- [ ] Hover card: cursor is a grab hand.
- [ ] Click-hold card: cursor becomes closed fist.
- [ ] Drag card: source card fades and scales slightly (still visible, but receded).
- [ ] Drag over valid column: column gets blue highlight.
- [ ] Drag over invalid column: column gets red highlight.
- [ ] Drop: displaced cards animate to new positions (FLIP).
- [ ] Select text in card on desktop: `select-none` prevents accidental selection.
- [ ] Touch device: no hover states; active feedback on tap.
- [ ] OS reduced-motion: cursor changes work, but no scale/rotate on drag source, no reorder animation.

---

## NEVER

- Add sound without user opt-in and volume control.
- Add sound in institutional, financial, medical, or enterprise contexts without an explicit brief.
- Override cursor on text, inputs, or textareas.
- Use scroll-snap on long vertical lists (traps users).
- Use custom SVG cursors as decoration (brand logo as cursor = noise, not craft).
- Apply juicy to a codebase that still has `transition-all` (fix finesse first).
- Assume touch users should see hover states — guard with `@media (hover: hover)`.
- Use `<audio>` for UI sounds — use AudioContext API for microsounds.

When game-feel layers on top of intentional motion, hand off to `/impeccable polish` for the final pass.
