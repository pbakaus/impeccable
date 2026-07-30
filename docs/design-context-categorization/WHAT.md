# What We're Building (First Draft)

A visual, browsable rendering of the 8-category design context map — Audience, Product, Brand, Color, Typography, Iconography, Material, Interface — so a user can click through and see, category by category, what `/impeccable` already extracts from a project (and, later, what it's still missing).

This is the **WHAT**, not the how: scope and shape, not component code. Two sources feed it, each responsible for a different half:

- **Interaction mechanics** (the tile-grid landing, the click-to-fullscreen morph, hash routing, responsive collapse) come from the `Puppy Wear Design Context V2.html` prototype — see "Reference architecture" below.
- **Visual UI** (the "inside" — sidebar, content layout, typography, color, both light and dark) comes from the live [impeccable.style/docs/](https://impeccable.style/docs/) page, i.e. the actual local files that render it in this repo — see "Local reference" below. Content and category definitions come from [`CONTENTS-TABLE.md`](./CONTENTS-TABLE.md).

Nothing here invents a third design language: the shape of the interaction is the prototype's, the skin is the live site's.

---

## Reference architecture — interaction mechanics only

Source: `Puppy Wear Design Context V2.html` (local prototype, not in this repo). What we take from it is behavior and geometry — how the tile grid is arranged, how a click turns into a fullscreen view, how that view is structured into regions and addressed by URL. The prototype's own CSS for what fills those regions (its sidebar/topbar/row styling, its color palette) is **not** carried over — that's replaced wholesale by the live site's actual components, described in "Visual language" below.

- **Landing state** — an 8-tile asymmetric mosaic grid (an 18-column × 12-row grid with hand-placed spans per tile, matching the prototype's exact tile placement) with a circular center badge sitting on the seam between tiles. One tile per category — Audience, Product, Brand, Color, Typography, Iconography, Material, Interface — label only, no content, until opened.
- **Open transition** — clicking a tile creates a container positioned/sized to start exactly at the clicked tile's on-screen rect, then animates position/size/corner-radius to fullscreen, with the inner content fading/sliding in after a short delay. Closing runs the same transition in reverse, back to the originating tile's rect, then removes the element. (This is the prototype's `.expander` / `.expander.is-full` / `.expander.is-ready` mechanism — same tween, same timing, just filled with the live site's markup instead of the prototype's own.)
- **Detail shell regions** — once open, the view splits into: a **sidebar** (all 8 categories listed flat, in `CONTENTS-TABLE.md`'s order — Audience, Product, Brand, Color, Typography, Iconography, Material, Interface — active one highlighted, with jump-target sub-links for categories that have sub-content; no thematic clustering, unlike the prototype's own Context/Foundations/System grouping), a **topbar** (current category name + close control), and a **main pane** (that category's content, scrollable). What renders inside each region is the live site's, not the prototype's — see "Visual language."
- **Hash routing** — the open category is reflected in the URL (`#color`), so it's deep-linkable and back/forward-navigable via `popstate`. `Escape` and the close button both dismiss it.
- **Responsive fallback** (below ~920px) — the mosaic grid becomes a flex column, one tile per row in a fixed reading order (Product, Audience, Brand, Color, Typography, Iconography, Material, Interface); the sidebar collapses to a horizontal scroll strip.

---

## Local reference — where impeccable.style/docs/ comes from

[impeccable.style/docs/](https://impeccable.style/docs/) is not an external design to imitate from a screenshot — it's this repo, live. The exact files that render it:

| What it renders | File |
| --- | --- |
| `/docs` landing page (start rail, command chooser, "Understand the system" list, full reference list) | [`site/pages/docs/index.astro`](../../site/pages/docs/index.astro) |
| `/docs/:slug` detail pages (one per command/reference topic — closest existing analog to a category detail view) | [`site/pages/docs/[...slug].astro`](../../site/pages/docs/%5B...slug%5D.astro) → [`site/layouts/Doc.astro`](../../site/layouts/Doc.astro) |
| Shared sidebar (grouped nav, one entry per item, `aria-current` for the active one) | [`site/components/DocsSidebar.astro`](../../site/components/DocsSidebar.astro) |
| Shared docs/sub-page layout shell (`.skills-layout`, `.skills-sidebar`, `.skills-main`, `.skills-detail`) | [`site/styles/sub-pages.css`](../../site/styles/sub-pages.css) |
| `/docs`-specific dark-lacquer skin + the `html.light` remap for this section | [`site/styles/docs-kinpaku.css`](../../site/styles/docs-kinpaku.css) |
| Sitewide brand tokens (colors, type) that everything above consumes | [`site/styles/kinpaku-tokens.css`](../../site/styles/kinpaku-tokens.css), [`site/styles/kinpaku-kit.css`](../../site/styles/kinpaku-kit.css) |
| Sitewide light-mode override layer | [`site/styles/light-mode.css`](../../site/styles/light-mode.css) |
| Theme toggle (auto/light/dark, `localStorage`-backed, sets `html.light`/`html.dark`) | [`site/scripts/utils/theme.js`](../../site/scripts/utils/theme.js), wired up in [`site/layouts/Base.astro`](../../site/layouts/Base.astro) (inline pre-paint script + `initThemeToggle()` call) |

We build against these files directly, in both resolved themes (`html.light` and `html.dark`), not a one-off recreation of how the page happens to look in a screenshot.

---

## UI sketch (ASCII)

Proportions are illustrative, not to scale — the point is the asymmetry and the center badge, not exact grid math. Labels like "sidebar" and "topbar" below are generic region names; what actually renders inside them is `DocsSidebar` / `Doc.astro`'s header+prose pattern per "Visual language" above, not the prototype's own chrome.

**Landing — 8-tile mosaic, nothing open:**

```
┌─────────────┬──────────────┬───────────────────┬─────────────┐
│             │              │                    │             │
│             │    BRAND     │                    │  TYPOGRAPHY │
│             │              │      AUDIENCE       │             │
│   PRODUCT   ├──────┬───────┤                     ├─────────────┤
│             │      │ (●)   │                     │             │
│             │ COLOR│ logo  ├─────────────────────┤   MATERIAL  │
├─────────────┤      │       │                     │             │
│ ICONOGRAPHY │      │       │      INTERFACE      │             │
└─────────────┴──────┴───────┴─────────────────────┴─────────────┘
```

**A tile mid-click, morphing toward fullscreen (FLIP animation):**

```
┌──────┬──────┬──────┐        ┌──────┬──────┬──────┐        ┌───────────────────────┐
│  P   │  B   │  A   │        │  P   │▓▓▓▓▓▓│  A   │        │                       │
├──────┼──────┼──────┤   →    ├──────┼▓▓▓▓▓▓┼──────┤   →    │      Color (open)     │
│  Ic  │ [C]★ │  In  │        │  Ic  │▓▓▓▓▓▓│  In  │        │                       │
└──────┴──────┴──────┘        └──────┴──────┴──────┘        └───────────────────────┘
    ★ user clicks "Color"      same element grows in place       sidebar + content
                                (top/left/width/height tween)     fade in ~260ms later
```

**Expanded — sidebar + topbar + main, "Color" open:**

```
┌───────────────┬─────────────────────────────────────────────────────────┐
│ Impeccable    │  Color                                              ✕  │
├───────────────┼─────────────────────────────────────────────────────────┤
│  · Audience   │  Color                                                  │
│  · Product    │  Palette, roles, tints, strategy, tonal ramps.          │
│  · Brand      │                                                          │
│  ► Color      │  ┌────────────────────────────────────────────────────┐ │
│    ↳ Palette  │  │ ░░░░  ▒▒▒▒  ▓▓▓▓  ████  ▓▓▓▓  ▒▒▒▒                 │ │
│  · Typography │  │        (swatch fan — hover fans out, click copies) │ │
│  · Iconography│  └────────────────────────────────────────────────────┘ │
│  · Material   │                                                          │
│  · Interface  │  ─────────────────────────────────────────────────────  │
│               │  Palette (hex)          DESIGN.md · colors     Derived  │
│               │  ─────────────────────────────────────────────────────  │
│               │  Roles                  DESIGN.md · Colors    In-chat   │
│               │  ─────────────────────────────────────────────────────  │
│               │  Strategy               Colors → Named Rules  In-chat   │
│               │  ─────────────────────────────────────────────────────  │
│               │  Tints                  colors (opacity)      Derived   │
│               │  ─────────────────────────────────────────────────────  │
│               │  Tonal ramps (OKLCH)    colorMeta.tonalRamp    Computed │
└───────────────┴─────────────────────────────────────────────────────────┘
```

The sidebar is flat, in `CONTENTS-TABLE.md`'s own category order — no thematic clustering like the prototype's Context/Foundations/System groups. Decided; see "Decisions" at the end.

**Responsive (< ~920px) — grid stacks, sidebar becomes a scroll strip:**

```
┌─────────────────────────┐        ┌──────────────────────────────────┐
│ PRODUCT                 │        │[Product][Audience][Brand][►Color]│
├─────────────────────────┤        │  ...horizontal scroll...       →│
│ AUDIENCE                │        ├──────────────────────────────────┤
├─────────────────────────┤        │  Color                       ✕  │
│ BRAND                   │        │                                  │
├─────────────────────────┤        │  ░░░ ▒▒▒ ▓▓▓ ███ ▓▓▓ ▒▒▒          │
│ COLOR                   │  tap → │                                  │
├─────────────────────────┤        │  Palette (hex)   ...    Derived │
│ TYPOGRAPHY              │        │  Roles            ...   In-chat │
├─────────────────────────┤        │  Strategy         ...   In-chat │
│ ICONOGRAPHY             │        │  ...                             │
├─────────────────────────┤        │                                  │
│ MATERIAL                │        │                                  │
├─────────────────────────┤        │                                  │
│ INTERFACE               │        │                                  │
└─────────────────────────┘        └──────────────────────────────────┘
```

---

## UX flow (ASCII)

```
                             ┌─────────────────────────┐
                    ┌───────►│         LANDING          │
                    │        │   8-tile mosaic grid,    │
                    │        │     nothing open         │
                    │        └────────────┬────────────┘
                    │                     │ click a tile
                    │                     │ (or page load with #hash)
                    │                     ▼
                    │        ┌─────────────────────────┐
                    │        │     OPEN TRANSITION      │
                    │        │  tile rect → fullscreen  │
                    │        │   (FLIP morph, ~500ms)   │
                    │        └────────────┬────────────┘
                    │                     │ morph completes
                    │                     ▼
                    │        ┌─────────────────────────┐
                    │   ┌───►│         EXPANDED          │◄───┐
                    │   │    │ sidebar + topbar + main   │    │
                    │   │    └────────────┬────────────┘    │
                    │   │                 │                  │
                    │   │     ┌───────────┼────────────┐     │
                    │   │     ▼           ▼            ▼     │
                    │   │ click a     click a      click a   │
                    │   │ different   subnav        swatch    │
                    │   │ category    link          → copy    │
                    │   │ in sidebar  → scroll to    hex,      │
                    │   │             that row      "Copied!"  │
                    │   │     │           │            │       │
                    │   │     └───────────┴────────────┘       │
                    │   │   re-render main, update hash,        │
                    │   └───────────── no re-morph ─────────────┘
                    │                     │
                    │                     │ Escape, or click ✕
                    │                     ▼
                    │        ┌─────────────────────────┐
                    │        │     CLOSE TRANSITION      │
                    └────────┤  fullscreen → tile rect   │
                             │   (reverse morph)          │
                             └─────────────────────────┘
```

Two entry points worth calling out: a direct tile click always starts from the tile's own rect (so the morph has somewhere real to animate from), while a page load with a `#category` hash in the URL skips straight to `EXPANDED` — the prototype does this via a short `setTimeout` rather than an instant snap, so the shell still feels like it "arrived" rather than being static markup.

---

## Visual language — the inside (and the mosaic's skin) is impeccable.style/docs/, not the prototype

The prototype supplies geometry and motion (previous section). Everything you'd actually call "the design" — color, type, borders, the sidebar, how a list of facts is laid out — comes from the live `/docs` implementation listed above, applied in both the regions the prototype defines (mosaic tiles, sidebar, topbar, main pane) and rendered correctly in both themes.

- **Mosaic tiles (landing)** — keep the prototype's asymmetric grid *placement* (which tile sits where, the center badge), but the tile surface itself — border, corner radius, hover/focus treatment, background — pulls from the same surface tokens the rest of the site already uses for card-like elements (`--docs-panel-bg`, `--docs-row-bg`, `--docs-row-hover-bg`, `--docs-accent` from `docs-kinpaku.css`), so a tile reads as a natural extension of the site's existing surfaces, not the prototype's flat white/black `oklch(0% 0 0)` outline treatment. Tile label typography uses the site's existing display font (whatever `docs-kinpaku.css` / `kinpaku-tokens.css` already sets for large display text), not the prototype's Alumni Sans Pinstripe.
- **Sidebar (inside)** — structurally and visually **`DocsSidebar.astro`**: the `skills-sidebar` / `skills-sidebar-label` / `skills-sidebar-list` / `aria-current` pattern, applied as a single flat `skills-sidebar-list` of all 8 categories in `CONTENTS-TABLE.md`'s own order (Audience, Product, Brand, Color, Typography, Iconography, Material, Interface) — no `skills-sidebar-group` clustering, since there's no thematic grouping to apply. Not the prototype's own `docs-sidebar` / `docs-nav-link` / `docs-subnav` CSS, nor its Context/Foundations/System clusters — those are discarded entirely; only the per-category jump-target sub-links survive as `docs-subnav`-equivalent behavior under the active entry.
- **Topbar + main pane (inside)** — structurally and visually **`Doc.astro`**'s `.skills-main` / `.skills-detail` pattern: a header (`.sub-page-header` → `.sub-page-title` + `.sub-page-lede`) playing the role of the prototype's topbar-plus-title, followed by a content body (`.skills-detail-body.docs-body.prose`) playing the role of the main pane. Each category's Value / Derived-from / Source rows render as the same label-plus-secondary-line row shape the live `/docs` index already uses for its "Full command reference" list (primary text + a muted description line), not the prototype's bordered `.detail-row` two-column table look.
- **Color's swatch fan / Typography's type sample / Material's line diagram** — these three specialized blocks have no equivalent on the live site (nothing there needs a color-swatch strip), so they're the one place the prototype's own markup and interaction *do* carry over structurally — but skinned with the site's color tokens, not the prototype's `--care-glow` / `--paw-proof` custom palette.
- **Theme** — driven entirely by the existing toggle (`theme.js`, `html.light` / `html.dark`, wired in `Base.astro`). Both themes are first-class from the start because we're building against `docs-kinpaku.css`'s existing dark/light rule pairs, not authoring a new palette that then needs a light variant invented after the fact.
- **Motion** — the tile→fullscreen morph timing/easing and the responsive breakpoint stay as defined in "Reference architecture"; none of that is affected by this section.

---

## Content model

Source of truth: [`CONTENTS-TABLE.md`](./CONTENTS-TABLE.md).

- **Legend** (5 source types: Derived, Questionnaire — In-chat (init), Questionnaire — In-chat (document), Questionnaire — Browser (document), Computed) — surfaced once, not per category (a persistent key, e.g. a footnote strip or an info toggle in the topbar).
- **8 categories**, each a list of rows: Value / Derived from / Source. Row counts vary today from 1 (Iconography) to 10 (Material).
- To avoid a second hand-maintained copy of the same data, the first build pass should read `CONTENTS-TABLE.md` directly (parsed into a small structured module at build time) rather than re-typing rows into markup. This doc stays the single source; the page is a renderer, not a fork.

---

## Explicitly out of scope for this first draft

- No live wiring to a real project's `PRODUCT.md` / `DESIGN.md` — this renders the fixed categorization, not a per-user report.
- No authoring/editing UI — read-only browse experience.
- Color's swatch-fan block (`.panel-colors`) carries over structurally, but `CONTENTS-TABLE.md` describes color *concepts* ("Palette (hex)", "Tints") rather than literal hex values — so it renders with placeholder/illustrative swatches for this first draft, not real per-project colors. Click-to-copy still works, just copies placeholder values.
- No new visual theme, font, or motion language beyond what gets set up by the token swap above.

---

## Decisions

1. **Sidebar grouping — flat, `CONTENTS-TABLE.md` order.** No thematic clusters (the prototype's Context/Foundations/System is dropped). All 8 categories sit at one level, in the exact order `CONTENTS-TABLE.md`'s own "Categories" list uses: Audience, Product, Brand, Color, Typography, Iconography, Material, Interface.
2. **Verification pass — confirmed.** Once built, screenshot-compare against the real `/docs` and `/docs/:slug` pages in both `html.light` and `html.dark`, same as any other `docs-kinpaku.css`-consuming page — not eyeballed once in whichever theme happens to be active during development.

## Deferred

- **Where this lives** (a page under `/docs`, e.g. filling the existing unused `Design Context` → `/docs/context` stub in `manualTopics` in [`site/pages/docs/index.astro`](../../site/pages/docs/index.astro), vs. its own standalone route) is not being decided as part of this draft. Revisit once the build is closer.
