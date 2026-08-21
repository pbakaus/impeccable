> **Additional context needed**: only the target element, when the request does not name one that resolves uniquely on the page.

Generate is a programmatic entry into live mode: the user names an element, a direction, and a count in one sentence, and you boot the live session, point the browser at the element, and the overlay scrolls to it, selects it, and fires the same Go a user click fires. Everything downstream is the standard live session. Read [live.md](live.md) in full now if you have not this session; this file is the entry ramp into its contract, and from Step 4 on you are inside it, with one deliberate divergence: Step 5 closes the session on its own once the accept lands, instead of staying open the way `live` does.

**Web only.** Live mode's browser overlay has no native equivalent; on `ios` / `android` / `adaptive` projects, decline this command and offer `bolder` or `quieter` on the source instead.

Three prohibitions cover the known ways this command goes wrong. Each names the tempting move first:

- The poll shows no generate event yet, and writing variants straight into source feels faster. **Never hand-write a variants wrapper or invent a session id.** Only the browser mints session ids (8 hex characters, at Go); the server refuses events for any other id, so a hand-built wrapper renders previews the user can never accept. No event means no session started; the fix lives in Step 2 or Step 3, never in a direct source edit.
- Handing the user a link to click feels polite. **Open the page yourself** (Step 2). The command's promise is hands-free; a pasted URL breaks it and usually means no page ever connects.
- The design hook may flag the preview scaffolding you just published. **Do not act on hook findings while live markers are in the file**, and do not restyle variants or surrounding content to appease them; previews are temporary by design, and `live-complete.mjs` verifies the file once the accepted variant is permanent. Current hooks stand down on their own when they see the markers; older installed hooks may still nag.

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
  - **Nothing fits**: `impeccable`, with the user's wording passed as the prompt.
  - **An action fits AND extra intent rides along** ("bolder, but keep it monochrome"): that action, with the rest as the prompt.
- **The element description** ("the pricing cards", "the hero heading"): Step 3 resolves it to a selector.

Done when you hold an action from the vocabulary, a count from 1 to 8, and the element description.

## Step 2: Boot live mode and open the page

Run the boot exactly as [live.md](live.md)'s Start section describes:

```bash
node {{scripts_path}}/live.mjs
```

**`config_missing` / `config_invalid`**: follow [live-setup.md](live-setup.md) first.

Then open the app URL that serves a `pageFiles` entry (never `serverPort`; that is the helper, not the app):

- **Cursor**: `browser_navigate` to the URL now; do not skip it.
- **Any other harness with a browser tool**: open the URL with that tool.
- **No browser tool exists in this harness**: tell the user the exact URL to open, and pass `--wait-for-browser 120000` in Step 3 so the command fires the moment their page connects.

Done when the boot printed `"ok": true` and a page with the overlay is connected, which Step 3 proves by answering anything other than `no_browser_connected`.

## Step 3: Target the element

Derive the selector from project source, not from guesswork: an id first, then a unique class, then a landmark tag plus class. **The request names a repeated component in plural** ("the pricing cards"): target the container that holds the set, so scoped CSS restyles every instance at once. **Unsure the selector resolves uniquely**: probe with `--dry-run`; it resolves and reports without starting anything, and it works even mid-session.

```bash
node {{scripts_path}}/live-generate.mjs --selector "section.pricing" --action bolder --count 3
```

Flags: `--selector` (required), `--action`, `--count`, `--prompt`, `--text` (keep only matches whose visible text contains a snippet), `--index` (1-based pick among matches), `--dry-run`, `--wait-for-browser <ms>`.

Every verdict carries `_instructions` with the next move for that exact situation, with real values filled in; follow them over your recollection of this file. Two verdicts deserve naming because their fix sits outside the command:

- **`no_browser_connected`**: Step 2's page is not actually open; open it yourself, then rerun.
- **`ambiguous`**: the candidates are listed in the output; target their common container, or rerun with `--text "<visible text>"` or `--index <n>`.

Done when the verdict is `ok: true` with a `sessionId`: the browser has scrolled to the element, entered the picked state, and fired Go.

## Step 4: Generate

Start the poll loop per your harness policy in [live.md](live.md). The queued event for the returned `sessionId` is a standard `generate` event carrying the picked element's context and the preflighted scaffold; handle it exactly per live.md's Handle generate: plan through the identity lock and the action's own reference (`reference/<action>.md` for named actions), deliver CSS plus all variants atomically at the scaffold's insert point, reply done, poll again.

Then tell the user, in one line, where their variants are: *"Three [bolder] variants are live on [the pricing cards]: cycle with the floating bar's arrows, adjust the Tune knobs, and Accept the keeper."*

**Publishing variants does not end the session.** Keep servicing the poll; accept, discard, and carbonize cleanup follow live.md unchanged, and the helper server stays up through the accept. Done when live.md's contract marks the event you handled complete and the poll is running again.

## Step 5: Close the session

Generate is a one-shot command; this is where it diverges from an open-ended `live` session. Once the accept (or discard) completes, wrap up without being asked: carbonize cleanup is done and `live-complete.mjs` printed `phase: "completed"` (a discard needs no cleanup), so kill your background poll and run live.md's Cleanup:

```bash
node {{scripts_path}}/live-server.mjs stop
```

Stopping removes the injected live script, and that removal reloads the page one last time: the user's browser now shows the accepted design with no overlay chrome, still served by their dev server.

- **The user asks for more variants before you wrapped up**: skip the wrap-up, target the next element through the same session (Step 3, with `--dry-run` first when the selector is uncertain), and wrap up after the last accept.
- Restarting the dev server to freshen the page feels like tidying. **Never kill or restart the user's dev server**, including one you started in Step 2. It keeps serving the accepted source after wrap-up; a tab that still looks stale needs one hard refresh, not a new server. A relaunched server also hops to the next free port and strands every open tab on the dead one.

Done when the helper is stopped, the stop output reported the script tag removed, and the dev site still answers with the accepted design.
