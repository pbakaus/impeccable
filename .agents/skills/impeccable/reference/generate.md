> **Additional context needed**: only the target element, when the request does not name one that resolves uniquely on the page.

Generate is the fast lane into live mode: the user names an element, a direction, and a count in one sentence, and within a minute they are cycling through variants in their browser. One command boots the helper, hands the element to the overlay in the page your harness already shows (it scrolls to it, selects it, and fires the same Go a click fires) and returns the generate event; one edit writes the variants; one call replies and waits for the user's choice, which the helper bakes into source itself. This file owns the lane's plumbing; from the event onward the design work is [live.md](live.md)'s, unchanged, so read it in full now if you have not this session.

**Web only.** Live mode's browser overlay has no native equivalent; on `ios` / `android` / `adaptive` projects, decline this command and offer `bolder` or `quieter` on the source instead.

The plumbing is where the lane saves time: one command starts the session around the page your harness already shows, one call replies and waits, and nothing here is a browser you have to babysit. The design work is not where it saves time. Setup runs as for any command (`impeccable context`, this reference, craft-floor.md before the edit), and the variants are planned, written, and accepted exactly the way a live session plans, writes, and accepts them.

Three prohibitions cover the known ways this command goes wrong:

- **Never run init or document, and never ask for PRODUCT.md or DESIGN.md.** When they exist, the start command prints them under `boot` and you use them. When they do not, it says so (`contextMissing`, `contextNote`) and you extract the identity from the event (Step 3). A missing file is never a reason to interview the user inside this command; offer `init` in one line after the session ends.
- **Never hand-write a variants wrapper or invent a session id.** Only the browser mints session ids (8 hex characters, at Go). A missing event is fixed by rerunning Step 2, never with a direct source edit.
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
  - **The wording names no direction at all** ("better", "improve", "nicer", "different", "fresh", "new", "redesign", "fix", "some options", "ideas", "alternatives", or just "variants" with nothing else): STOP and use Codex's structured user-input/question tool when available; if unavailable, ask directly in chat to clarify what you cannot infer. Ask one question, offering the vocabulary: *"Which direction should the variants take? bolder, quieter, simpler (distill), polished, typography (typeset), color (colorize), layout, motion (animate), playful (delight), or rule-breaking (overdrive)."* Map the answer with this list; an answer that is still open ("surprise me", "you pick") is `impeccable` with the user's original wording as the prompt, and Step 2 starts on that answer.
- **The element description** ("the pricing cards", "the hero heading"): Step 2 resolves it to a selector.

Done when you hold an action from the vocabulary (asked for, when the request named no direction), a count from 1 to 8, and the element description.

## Step 2: Reuse the page, then start

**Reuse** the dev server already running and the tab your harness already shows it in; a second server or a second browser window is the failure this step prevents.

1. **Find the dev server**, cheapest source first, and stop at the first hit: the user's message, a browser tab already on the app (Claude Code: an origin in `tabs_context`), a server your harness started (Claude Code: `preview_list`), a terminal that printed its URL. Its origin is your `--dev-url`. **No hit**: leave `--dev-url` off and run the start command with no wait; the boot probes for a running server and its verdict names the move. `browser_needed` carries the `devUrl` it found: open it as in 2, then rerun with `--dev-url <devUrl> --wait-for-browser 60000`. `no_dev_server` means nothing serves the app: start the dev script the way the verdict says (Claude Code: `preview_start`; Cursor: a background terminal; Codex: an exec you yield from), wait for its URL, then rerun with `--dev-url <url>`.
2. **Open the page that renders the element in your browser, then start.** The route the request names, else the one `--target` serves; `--dev-url` takes only the origin.
   - **Cursor** (`browser_navigate`) and **Claude Code** (`navigate`, which opens the Browser pane when it is closed and takes the `tabId` from `tabs_context` when a tab is already on that origin): open the URL, then run the start command with `--dev-url <url> --wait-for-browser 60000`. The boot injects the overlay and the page reloads into it while the command waits. Your browser tool is the only opener on these harnesses; the engine ignores `--open` there.
   - **No browser tool** (Codex, others): run the start command with `--open --wait-for-browser 120000`; it opens the system browser, and the longer wait covers the user finding the tab. **`browser_open_failed` back**: tell the user the `url` in one line and rerun with `--wait-for-browser 120000`.

```bash
.agents/skills/impeccable/scripts/impeccable live-generate --target src/App.jsx --dev-url http://127.0.0.1:5173/ --selector ".pricing-grid" --action bolder --count 3 --boot --wait-for-browser 60000
```

Run it in the foreground in Cursor and Claude Code (it returns within the wait); on Codex, in an exec you yield from, the way Step 3 runs the poll.

- `--target`: the file that renders the element when the request or the project makes it obvious; skip it otherwise.
- `--dev-url`: the origin from 1; omit it and the boot probes.
- `--selector`: a unique class first, then a landmark tag plus class, an id last (every variant mounts a copy of the element, so an id repeats in the DOM). **The request names a repeated component in plural** ("the pricing cards"): target the container that holds the set, so one scoped stylesheet restyles every instance. One read of the source file that renders the element is allowed when the selector is not obvious; `--dry-run` resolves and reports without starting anything when it is not certain.
- `--boot`: runs the lane's boot (PRODUCT.md and DESIGN.md loaded again for the helper, missing files tolerated, dev URL found, bottom bar hidden for the helper's lifetime) and reuses a helper that is already running. Its result rides along as `boot`.
- Also available: `--prompt`, `--text` (keep only matches whose visible text contains a snippet), `--index` (1-based pick among matches).

Read the output in this order: `boot` (or `boot.contextMissing` with `boot.contextNote`: the page is the source of truth, per the note), then `event`, the generate event for `sessionId`, with the same `_instructions` a user's Go gets. Every verdict carries `_instructions`, and they win over your recollection of this file; the ones whose move is a decision of yours:

- **`ambiguous`**: the candidates are listed; target their common container, or rerun with `--text "<visible text>"` or `--index <n>`.
- **`dev_server_gone`**: the dev server stopped answering while the command waited for the page (on Cursor, a server another chat started dies with that chat). Start it the way the verdict says, then rerun with `--dev-url <url>`.
- **`no_match`**: the tab is on a route that does not render the element (navigate to the right route, rerun), or the selector is wrong (derive a better one from the source, or add `--text`).
- **`config_missing` / `config_invalid`** under `bootError`: follow [live-setup.md](live-setup.md) first, then rerun.
- **`event: null`** with `ok: true`: the event was slower than the wait; run `.agents/skills/impeccable/scripts/impeccable live-poll` once to collect it, then continue.

Done when the output shows `ok: true`, a `sessionId`, and an `event`, reached with at most one server started and one tab opened by you.

## Step 3: Generate

The event is a standard `generate` event: the picked element's context, a preflighted scaffold, and `_instructions` naming the action's reference, the planning section, and the exact splice. Handle it exactly per live.md's **Handle generate**, which owns everything from the identity lock to the done reply: read the action's reference and craft-floor.md as it says, plan per section 4 (identity first, then mode, then three different primary axes, then the squint test), declare knobs per section 7, and deliver per section 6 (a complete replacement of the element per variant, the preview CSS plus every variant in one edit at the scaffold's splice). The lane changes nothing about what a variant may be: the moves a live session would make on this element (a promoted tier, a restructured set, a reordered card, a different surface) are open here too. Never screenshot the page; the overlay preview is the review channel until accept.

**Reply and wait in one call**, with the file you wrote:

```bash
.agents/skills/impeccable/scripts/impeccable live-poll --reply EVENT_ID done --file src/App.jsx --then-poll
```

This replies done (the browser mounts the variants) and then blocks until the user's choice arrives, so run it the way your harness runs a long wait: **Claude Code** in the foreground with your tool's longest timeout (600000 ms), so you are paused until the choice arrives; **Codex** in a yielded foreground exec; **Cursor** in a background terminal with notify on `"type":"(accept|discard|variant_mount_failed|exit)"`. Never pass a short `--timeout=`. While it runs there is nothing else to do: never sleep and never poll its output on a timer; a harness that backgrounds it wakes you when it returns. `{"type":"timeout"}` means the user has not chosen yet: run `live-poll` again and keep waiting. If the edit fails after the browser flipped to GENERATING, `--reply EVENT_ID error "Short reason"` (without `--then-poll`) so the bar resets.

Then tell the user, in one line, where their variants are: *"Three [bolder] variants are live on [the pricing cards]: cycle with the floating bar's arrows, adjust the Tune knobs, and Accept the keeper."*

Outside the replace path, read the matching live.md section before acting: `scaffold.previewMode: "svelte-component"` (Svelte previews are edited as components, and their accept is mechanical), `mode: "insert"`, `variant_mount_failed`, `steer`, `manual_edit_apply`, and any `fallback: "agent-driven"` wrap error.

## Step 4: Accept and close

The call from Step 3 returns the user's choice. **`discard`**: nothing to do. **`accept`**: `_acceptResult.carbonize: true` is the normal case, and the cleanup is live.md's **Required after accept**, unchanged: move the accepted variant's rules into the stylesheet that already owns the element with real selectors, bake the chosen knob values in, unwrap the element and drop every `data-impeccable-*` attribute, delete the inline `<style>` block and both `impeccable-carbonize` markers, then `.agents/skills/impeccable/scripts/impeccable live-complete --id SESSION_ID` and confirm `phase: "completed"`. (`baked: true` appears only when the accept was run with `--bake`; then the helper already made the variant permanent and no `live-complete` is owed.)

Close without being asked, the moment the choice is handled:

```bash
.agents/skills/impeccable/scripts/impeccable live-server stop
```

Stopping removes the injected script and reloads the page once: the user sees the accepted design with no overlay chrome, still served by their dev server. **Never kill or restart the dev server**, including one you started in Step 2.

- **The user asks for more variants before you closed**: skip the close, run Step 2 again for the next element (the helper is reused), and close after the last choice.
- **Interrupted or unsure of the state**: `.agents/skills/impeccable/scripts/impeccable live-status`, then `live-resume`; the journal under `.impeccable/live/sessions/` is canonical.

Done when the helper is stopped and the dev site still answers with the accepted design.
