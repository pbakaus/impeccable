> **Additional context needed**: only the target element, when the request does not name one that resolves uniquely on the page.

Generate is the fast lane into live mode: the user names an element, a direction, and a count in one sentence, and within a minute they are cycling through variants in their browser. One command boots the helper, hands the element to the overlay in the page your harness already shows (it scrolls to it, selects it, and fires the same Go a click fires) and returns the generate event; one edit writes the variants; one call replies and waits for the user's choice, which the helper bakes into source itself. This file is the whole contract for that lane; read [live.md](live.md) only for a situation Step 3 names as outside the lane.

**Web only.** Live mode's browser overlay has no native equivalent; on `ios` / `android` / `adaptive` projects, decline this command and offer `bolder` or `quieter` on the source instead.

Speed is the product here. Every tool call before the variants land is a second the user spends staring at a selected element. The lane below is three impeccable commands and one edit around the page your harness already shows; anything beyond it needs a reason from the output in front of you. **Skip Setup step 1 for this command**: do not run `impeccable context`; the boot inside Step 2 loads PRODUCT.md, DESIGN.md, and the surface brief itself. This lane also replaces Setup step 3 for the preview edit: the floors craft-floor.md guards are written into Step 3, so do not open craft-floor.md, and read the action's reference only when Step 3 says so.

Four prohibitions cover the known ways this command goes wrong:

- **Never run init or document, and never ask for PRODUCT.md or DESIGN.md.** When they exist, the start command prints them under `boot` and you use them. When they do not, it says so (`contextMissing`, `contextNote`) and you extract the identity from the event (Step 3). A missing file is never a reason to interview the user inside this command; offer `init` in one line after the session ends.
- **Never hand-write a variants wrapper or invent a session id.** Only the browser mints session ids (8 hex characters, at Go). A missing event is fixed by rerunning Step 2, never with a direct source edit.
- **Never declare parameter knobs** (`data-impeccable-params`). A variant is a finished design to choose from; the helper bakes the accepted one mechanically, and knobs would block that. Tunable knobs are plain `live`'s job.
- **Do not act on hook findings while live markers are in the file**, and do not restyle variants to appease them; the accept verifies the file once the variant is permanent.

## Step 1: Parse the request

Three parts, all from the user's sentence:

- **A number in the request**: that is the count. **No number**: 3. The protocol caps count at 8.
- **The direction wording** maps onto the live action vocabulary; never invent a new action value:
  - **bold, bolder, stronger, punchier**: `bolder`
  - **quiet, calmer, softer, toned down**: `quieter`
  - **simpler, minimal, stripped**: `distill`
  - **refined, tightened, polished**: `polish`
  - **font and type words**: `typeset`
  - **color words**: `colorize`
  - **arrangement and spacing words**: `layout`
  - **device and breakpoint words**: `adapt`
  - **motion words**: `animate`
  - **playful words**: `delight`
  - **rule-breaking words**: `overdrive`
  - **Wording that carries intent but no vocabulary word** ("make it feel like a bank", "warmer", "more premium"): `impeccable`, with the user's wording passed as the prompt.
  - **An action fits AND extra intent rides along** ("bolder, but keep it monochrome"): that action, with the rest as the prompt.
  - **The wording names no direction at all** ("better", "improve", "nicer", "different", "fresh", "new", "redesign", "fix", "some options", "ideas", "alternatives", or just "variants" with nothing else): {{ask_instruction}} Ask one question, offering the vocabulary: *"Which direction should the variants take? bolder, quieter, simpler (distill), polished, typography (typeset), color (colorize), layout, motion (animate), playful (delight), or rule-breaking (overdrive)."* Map the answer with this list; an answer that is still open ("surprise me", "you pick") is `impeccable` with the user's original wording as the prompt, and Step 2 starts on that answer.
- **The element description** ("the pricing cards", "the hero heading"): Step 2 resolves it to a selector.

Done when you hold an action from the vocabulary (asked for, when the request named no direction), a count from 1 to 8, and the element description.

## Step 2: Reuse the page, then start

**Reuse** the dev server already running and the tab your harness already shows it in; a second server or a second browser window is the failure this step prevents.

1. **Find the dev server**, cheapest source first, and stop at the first hit: the user's message, a browser tab already on the app (Claude Code: an origin in `tabs_context`), a server your harness started (Claude Code: `preview_list`), a terminal that printed its URL. Its origin is your `--dev-url`. **No hit**: leave `--dev-url` off and run the start command with no wait; the boot probes for a running server and its verdict names the move. `browser_needed` carries the `devUrl` it found: open it as in 2, then rerun with `--dev-url <devUrl> --wait-for-browser 60000`. `no_dev_server` means nothing serves the app: start the dev script the way the verdict says (Claude Code: `preview_start`; Cursor: a background terminal; Codex: an exec you yield from), wait for its URL, then rerun with `--dev-url <url>`.
2. **Open the page that renders the element in your browser, then start.** The route the request names, else the one `--target` serves; `--dev-url` takes only the origin.
   - **Cursor** (`browser_navigate`) and **Claude Code** (`navigate`, which opens the Browser pane when it is closed and takes the `tabId` from `tabs_context` when a tab is already on that origin): open the URL, then run the start command with `--dev-url <url> --wait-for-browser 60000`. The boot injects the overlay and the page reloads into it while the command waits. Your browser tool is the only opener on these harnesses; the engine ignores `--open` there.
   - **No browser tool** (Codex, others): run the start command with `--open --wait-for-browser 120000`; it opens the system browser, and the longer wait covers the user finding the tab. **`browser_open_failed` back**: tell the user the `url` in one line and rerun with `--wait-for-browser 120000`.

```bash
{{scripts_path}}/impeccable live-generate --target src/App.jsx --dev-url http://127.0.0.1:5173/ --selector ".pricing-grid" --action bolder --count 3 --boot --wait-for-browser 60000
```

Run it in the foreground in Cursor and Claude Code (it returns within the wait); on Codex, in an exec you yield from, the way Step 3 runs the poll.

- `--target`: the file that renders the element when the request or the project makes it obvious; skip it otherwise.
- `--dev-url`: the origin from 1; omit it and the boot probes.
- `--selector`: a unique class first, then a landmark tag plus class, an id last (every variant mounts a copy of the element, so an id repeats in the DOM). **The request names a repeated component in plural** ("the pricing cards"): target the container that holds the set, so one scoped stylesheet restyles every instance. One read of the source file that renders the element is allowed when the selector is not obvious; `--dry-run` resolves and reports without starting anything when it is not certain.
- `--boot`: runs the lane's boot (context loaded, missing files tolerated, dev URL found, bottom bar hidden for the helper's lifetime) and reuses a helper that is already running. Its result rides along as `boot`.
- Also available: `--prompt`, `--text` (keep only matches whose visible text contains a snippet), `--index` (1-based pick among matches).

Read the output in this order: `boot.product` / `boot.design` / `boot.surfaceBrief` (or `boot.contextMissing` with `boot.contextNote`: the page is the source of truth, per the note), then `event`, the generate event for `sessionId`, with `_instructions` that carry the whole plan. Every verdict carries `_instructions`, and they win over your recollection of this file; the ones whose move is a decision of yours:

- **`ambiguous`**: the candidates are listed; target their common container, or rerun with `--text "<visible text>"` or `--index <n>`.
- **`no_match`**: the tab is on a route that does not render the element (navigate to the right route, rerun), or the selector is wrong (derive a better one from the source, or add `--text`).
- **`config_missing` / `config_invalid`** under `bootError`: follow [live-setup.md](live-setup.md) first, then rerun.
- **`event: null`** with `ok: true`: the event was slower than the wait; run `{{scripts_path}}/impeccable live-poll` once to collect it, then continue.

Done when the output shows `ok: true`, a `sessionId`, and an `event`, reached with at most one server started and one tab opened by you.

## Step 3: Generate

The event's `_instructions` are the plan: the fast path names the identity sources (the event's `element.computedStyles`, `cssCustomProperties`, and `parentContext`, plus `boot`), the three dimensions your variants vary for this action, and the exact splice. Do it in ONE edit and reply. Concretely:

1. **Identity, one sentence, from the event.** Real colors, faces, corners, borders, shadows, and the layout topology on screen. `boot.design` wins when it is present, and it is a boundary, not a mood board: its tokens and named rules hold in every variant. Amplify inside them (a system that forbids fills, shadows, tints, or unequal columns gets its boldest allowed move on that axis, not the forbidden one), and leave the tokens an axis does not need exactly as written (radius, border, padding, the one bold weight). Leaving the system is the user's decision to make afterwards, never a variant's. Never read PRODUCT.md, DESIGN.md, live.md, or craft-floor.md for this; never screenshot the page.
2. **The action's reference is optional.** Read `reference/<action>.md` only when the prompt or the element makes the direction unclear; the `_instructions` already carry the action's three dimensions.
3. **Write the splice.** The event's `scaffold` tells you where: `sourceWritten: false` hands you `wrapperBlock` and the source range to replace (`replaceStartLine` to `replaceEndLine`); a written wrapper hands you `file` and `insertLine`. Either way, one edit lands the preview CSS plus all variants:

```html
<!-- Variants: insert below this line -->
<style data-impeccable-css="SESSION_ID">
  @scope ([data-impeccable-variant="1"]) { :scope > .pricing { ... } }
  @scope ([data-impeccable-variant="2"]) { :scope > .pricing { ... } }
  @scope ([data-impeccable-variant="3"]) { :scope > .pricing { ... } }
</style>
<div data-impeccable-variant="1"><!-- full element, variant 1 --></div>
<div data-impeccable-variant="2" style="display: none"><!-- variant 2 --></div>
<div data-impeccable-variant="3" style="display: none"><!-- variant 3 --></div>
```

   Rules that keep the browser mounting what you wrote, and the accept baking it:
   - each variant div holds exactly one top-level element, same tag as the original, its id or class kept so the bake can anchor its selectors, copy verbatim;
   - first variant visible, the rest `display: none`;
   - every `:scope` rule steps into a descendant (`:scope > .card`; a bare `:scope` or a sibling combinator on it breaks the bake);
   - the variant's own markup carries no `data-impeccable-*` attributes;
   - the event's `cssAuthoring` wins over the sketch above for `styleTag` and selector strategy;
   - **JSX / TSX**: wrap the `<style>` content in a template literal, use `className=` and `style={{ display: 'none' }}`, keep `data-impeccable-*` attributes as plain strings.
4. **No knobs**, per the prohibition above: `data-impeccable-params`, `data-p-*` selectors, or `var(--p-*)` values turn the mechanical accept into a manual one.
5. **Floors, by construction**: body text contrast 4.5:1 or better, no text under 12px, controls at least 40px tall, focus states kept. Do not verify beyond that; the overlay preview is the review channel until accept.
6. **Reply and wait in one call**, with the file you wrote:

```bash
{{scripts_path}}/impeccable live-poll --reply EVENT_ID done --file src/App.jsx --then-poll
```

   This replies done (the browser mounts the variants) and then blocks until the user's choice arrives, so run it the way your harness runs a long poll: **Cursor** in a background terminal with notify on `"type":"(accept|discard|variant_mount_failed|exit)"`; **Claude Code** as a background task; **Codex** in a yielded foreground exec session. Never pass a short `--timeout=`. If the edit fails after the browser flipped to GENERATING, `--reply EVENT_ID error "Short reason"` (without `--then-poll`) so the bar resets.

Then tell the user, in one line, where their variants are: *"Three [bolder] variants are live on [the pricing cards]: cycle with the floating bar's arrows and Accept the keeper."*

Outside the lane, read the matching live.md section before acting: `scaffold.previewMode: "svelte-component"` (Svelte previews are edited as components, and their accept was always mechanical), `mode: "insert"`, `variant_mount_failed`, `steer`, `manual_edit_apply`, and any `fallback: "agent-driven"` wrap error.

## Step 4: Accept and close

The call from Step 3 returns the user's choice. **`discard`**: nothing to do. **`accept` with `_acceptResult.baked: true`**: the helper already made the variant permanent (its rules were rewritten to real selectors and appended to `_acceptResult.css.file`, or to the page's own `<style>` block; the wrapper is gone; the session is complete): nothing to do, and no `live-complete`. Do not re-read or restyle the file.

**`accept` with `carbonize: true`** (the bake was not mechanical; `bakeSkipped` says why): finish it by hand in one pass over `_acceptResult.file` and the stylesheet that already owns the element's styling: move the accepted variant's rules into that stylesheet with real selectors (`@scope ([data-impeccable-variant="N"]) { :scope > .x }` becomes `.pricing > .x`), unwrap the element and drop every `data-impeccable-*` attribute, delete the inline `<style>` block and both `impeccable-carbonize` markers, then `{{scripts_path}}/impeccable live-complete --id SESSION_ID` and confirm `phase: "completed"`. Reads before that bake: `_acceptResult.file` and the stylesheet, nothing else.

Close without being asked, the moment the choice is handled:

```bash
{{scripts_path}}/impeccable live-server stop
```

Stopping removes the injected script and reloads the page once: the user sees the accepted design with no overlay chrome, still served by their dev server. **Never kill or restart the dev server**, including one you started in Step 2.

- **The user asks for more variants before you closed**: skip the close, run Step 2 again for the next element (the helper is reused), and close after the last choice.
- **Interrupted or unsure of the state**: `{{scripts_path}}/impeccable live-status`, then `live-resume`; the journal under `.impeccable/live/sessions/` is canonical.

Done when the helper is stopped and the dev site still answers with the accepted design.
