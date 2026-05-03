# ADR: Live Variant Mode

**Status:** Implemented (v3.1, feature branch `feature/single-skill-consolidation`)
**Date:** 2026-04-12
**Author:** Paul Bakaus + Claude

## Context

Impeccable is a design skill for AI coding agents. It teaches AI harnesses (Claude Code, Cursor, Gemini CLI, Codex, etc.) how to produce better frontend design. The skill has 22 commands (bolder, quieter, polish, typeset, etc.) that the agent runs on source code.

The missing piece: there was no way to visually iterate on a live page. The user could ask the agent to "make this bolder," but they had to read the code diff, reload the page, and decide if they liked it. If not, they'd ask again, wait, reload, repeat. Slow and disconnected.

**Goal:** Let the user select an element directly in the browser, pick a design action, and see N real HTML+CSS variants hot-swapped in. Cycle through them visually, accept or discard, repeat. The agent generates the variants; the browser shows them.

## Decision

Build a self-contained live variant mode that ships as part of the impeccable skill (no separate npm install required). The system bridges three parties: the **browser** (where the user picks elements and cycles variants), the **server** (a localhost HTTP server that relays messages), and the **agent** (the AI that generates variants by modifying source files).

### Key architectural decisions

**1. Source modification, not DOM patching.**
Variants are written to the actual source file, not injected into the browser DOM. This means:
- Framework state (React, Vue, etc.) is preserved because the framework's own rendering pipeline handles the update via HMR.
- "Accept" is trivial: the winning variant is already in the source. Just remove the other variants.
- Variants are real code that the user can inspect in their editor, diff, and commit.

**2. SSE + fetch, not WebSocket.**
Server-Sent Events (server to browser) + fetch POST (browser to server) instead of WebSocket. This eliminates the `ws` npm dependency entirely. The server is zero-dependency pure Node.js (http, crypto, fs, net, os). This matters because the scripts ship inside the skill directory and run in the user's project without any package installation.

**3. Self-contained skill scripts.**
All live mode code lives in `source/skills/impeccable/scripts/`:
- `live-server.mjs` — HTTP server (SSE, poll, source file reader)
- `live-poll.mjs` — CLI client for the agent poll/reply loop
- `live-wrap.mjs` — CLI helper that finds elements in source and creates variant wrappers
- `live-browser.js` — Browser script (element picker, action panel, variant cycler, global bar)

When a user installs the skill via `npx skills add pbakaus/impeccable`, they get the live mode without any additional setup. The agent runs the scripts via `node {{scripts_path}}/live-server.mjs`.

**4. HTTP long-poll for the agent, not WebSocket or stdin.**
The agent communicates with the server via HTTP long-poll (`GET /poll` blocks until a browser event arrives). This works across all AI harnesses because every harness can run a shell command and read its stdout. No harness-specific integration needed.

**5. `display: contents` variant wrapper.**
Variants are wrapped in a container with `display: contents`, which makes the wrapper invisible to CSS layout. The selected element's relationship with its parent (flex child, grid child, etc.) is preserved. The wrapper carries `data-impeccable-variants` and `data-impeccable-variant-count` attributes that the browser script uses to detect and cycle variants.

**6. No-HMR fallback.**
For dev servers that don't support HMR (like Bun's static HTML import), the browser fetches the raw source file directly from the live server's `/source` endpoint and injects the variants into the DOM. This works universally, at the cost of losing framework state on that injection.

## Architecture

```
 ┌─────────────────────────────────────────────────────────────────┐
 │                         BROWSER                                 │
 │                                                                 │
 │  live-browser.js (injected via <script> tag in source HTML)     │
 │  ├── Element picker (mousemove highlight, click select,         │
 │  │   keyboard nav: arrows=siblings, shift+arrows=parent/child)  │
 │  ├── Action bar (floating pill: action picker, freeform input,  │
 │  │   variant count, go button; morphs to generating/cycling)    │
 │  ├── Global bar (bottom pill: Detect toggle, Pick toggle, Exit) │
 │  ├── Variant cycler (MutationObserver watches for new           │
 │  │   [data-impeccable-variant] children in DOM)                 │
 │  ├── SSE connection (EventSource → /events for server push)     │
 │  ├── fetch POST (→ /events for browser-to-server messages)      │
 │  └── localStorage (session state survives reloads)              │
 │                                                                 │
 └────────────┬──────────────────────────────────┬─────────────────┘
              │ SSE (server → browser)           │ POST (browser → server)
              │ EventSource /events              │ fetch /events
              ▼                                  ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │                      LIVE SERVER                                │
 │                                                                 │
 │  live-server.mjs (node, localhost:8400+, zero dependencies)     │
 │  ├── GET  /live.js     — browser script (token injected)        │
 │  ├── GET  /detect.js   — anti-pattern overlay (backwards compat)│
 │  ├── GET  /events      — SSE stream to browser (server push)    │
 │  ├── POST /events      — browser events (generate, accept, etc.)│
 │  ├── GET  /poll        — agent long-poll (blocks until event)   │
 │  ├── POST /poll        — agent reply (forwarded to browser SSE) │
 │  ├── GET  /source      — raw file reader (no-HMR fallback)     │
 │  ├── GET  /health      — status, port, connected clients        │
 │  └── GET  /stop        — graceful shutdown                      │
 │                                                                 │
 │  State: session token, SSE client set, event queue, poll queue  │
 │  Server file: .impeccable/live/server.json (project root)        │
 │                                                                 │
 └────────────┬──────────────────────────────────┬─────────────────┘
              │ GET /poll (long-poll)             │ POST /poll (reply)
              │ blocks until browser event        │ forwarded to SSE
              ▼                                  ▲
 ┌─────────────────────────────────────────────────────────────────┐
 │                         AGENT                                   │
 │                                                                 │
 │  Follows source/skills/impeccable/reference/live.md             │
 │  1. Start server: node scripts_path/live-server.mjs &           │
 │  2. Inject <script> into source HTML (comment-marked)           │
 │  3. Poll loop:                                                  │
 │     ├── generate → wrap + write variants + reply done           │
 │     ├── accept  → present variant code + cleanup + reply done   │
 │     ├── discard → restore original + reply done                 │
 │     ├── exit    → cleanup script tag + stop server              │
 │     └── timeout → re-poll                                       │
 │                                                                 │
 │  Tools used per generation:                                     │
 │  1. node live-wrap.mjs (find element, create wrapper)           │
 │  2. Edit (write all variants in single edit)                    │
 │  3. node live-poll.mjs --reply <id> done --file <path>          │
 │                                                                 │
 └─────────────────────────────────────────────────────────────────┘
```

## Message flow

### Generate variants

```
User clicks element → picks "Bolder" → clicks Go
  ↓
Browser POST /events: {type:"generate", id:"abc", action:"bolder", count:3, element:{...}}
  ↓
Server enqueues event
  ↓
Agent GET /poll returns: {type:"generate", id:"abc", action:"bolder", count:3, element:{...}}
  ↓
Agent runs: node live-wrap.mjs --id abc --count 3 --classes "hero-left"
  → Finds element in source, wraps with data-impeccable-variants container
  → Original stays visible (no flash of empty content)
  ↓
Agent writes all 3 variants in a single Edit tool call
  → Each variant is a <div data-impeccable-variant="N"> with full HTML replacement
  → First variant visible, others display:none
  ↓
Agent POST /poll: {id:"abc", type:"done", file:"public/index.html"}
  ↓
Server forwards via SSE to browser: {type:"done", file:"public/index.html"}
  ↓
Browser checks: variants in DOM? (HMR)
  YES → MutationObserver detected them → show cycling bar
  NO  → fetch /source?path=public/index.html → parse → inject → show cycling bar
```

### Accept variant

```
User clicks Accept on variant 2
  ↓
Browser POST /events: {type:"accept", id:"abc", variantId:"2"}
Browser shows "Applying variant..." spinner
  ↓
Agent GET /poll returns: {type:"accept", id:"abc", variantId:"2"}
Agent reads variant 2 HTML from source, presents to user
Agent removes variant wrapper, restores clean source
Agent POST /poll: {id:"abc", type:"done"}
  ↓
Browser receives done via SSE → green "Variant applied" confirmation → auto-dismiss
```

### Discard

```
User clicks Discard (or presses Escape)
  ↓
Browser POST /events: {type:"discard", id:"abc"}
Browser immediately: restores original element in DOM, hides bar, resets to PICKING
  ↓
Agent GET /poll returns: {type:"discard", id:"abc"}
Agent removes variant wrapper from source, restores original
Agent POST /poll: {id:"abc", type:"done"}
```

## Variant wrapper format

In the source file (HTML example):

```html
<!-- impeccable-variants-start abc12345 -->
<div data-impeccable-variants="abc12345" data-impeccable-variant-count="3" style="display: contents">
  <div data-impeccable-variant="original">
    <!-- original element (visible until first variant arrives) -->
  </div>
  <div data-impeccable-variant="1">
    <!-- variant 1 (visible) -->
  </div>
  <div data-impeccable-variant="2" style="display: none">
    <!-- variant 2 -->
  </div>
  <div data-impeccable-variant="3" style="display: none">
    <!-- variant 3 -->
  </div>
</div>
<!-- impeccable-variants-end abc12345 -->
```

Comment markers enable deterministic cleanup. `display: contents` on the wrapper preserves flex/grid layout. The `data-impeccable-variant-count` attribute tells the browser how many to expect.

## Browser UI

### Global bar (always visible during live mode)

Compact floating pill at bottom center. Light, translucent, matching the brand aesthetic.

- **Impeccable** brand mark (magenta)
- **Detect** toggle (eye icon): loads anti-pattern scanner in extension mode, shows overlay count badge
- **Pick** toggle (crosshair icon): enables/disables element picker (default: on)
- **Exit** button (x): sends exit event, tears down all UI

When both Detect and Pick are active, detect overlays get `pointer-events: none` so the picker sees through them. The picker's z-index (100001) is above detect overlays (99999).

### Action bar (floating, contextual)

Appears below the selected element. Morphs between states:

- **Configure**: `[Action pill ▾] [freeform input] [×3] [Go →]`
- **Generating**: `[Action label] [● ● ○] Generating 2 of 3...`
- **Cycling**: `[←] [● ● ●] 2/3 [→] [✓ Accept] [✕]`
- **Saving**: `[spinner] Applying variant...`
- **Confirmed**: `[✓ Variant applied]` (green, auto-dismisses after 1.8s)

## Session persistence

`localStorage` stores:
- Session state (id, action, count, arrived variants, visible variant)
- Handled sessions (accepted/discarded session IDs)

This survives page reloads, browser close/reopen, HMR, and accidental refreshes. On page load, `resumeSession()` checks for an active variant wrapper in the DOM + the localStorage state and resumes the correct cycling position.

## Security

- **Session token**: `crypto.randomUUID()`, checked on all mutating endpoints and SSE connections.
- **Localhost only**: server binds to `127.0.0.1`, not `0.0.0.0`.
- **Token in server file**: `.impeccable/live/server.json` in project root. Only the user's processes can read it.
- **Token injected into `/live.js`**: the server prepends `window.__IMPECCABLE_TOKEN__` at serve time.
- **Path traversal guard**: `/source` endpoint validates the requested path is within `process.cwd()`.
- **No eval/innerHTML**: all browser UI built with `createElement` and `textContent`.

## Server resilience

- **Debounced exit**: when all SSE clients disconnect, the server waits 8 seconds before signaling exit to the agent. This avoids false exits from HMR reloads and brief network blips.
- **Stale PID detection**: on startup, the server checks if an existing PID file's process is still running. Dead processes are cleaned up automatically.
- **Browser server-lost handling**: after 5 failed SSE reconnection attempts, the browser cleans up all UI and shows a "Live server disconnected" toast.

## Performance optimizations

The generation loop was optimized from ~40s to ~15-20s:

1. **`wrap` CLI helper**: one command replaces 3-4 agent tool calls (grep + read + edit). Finds the element by ID/class/tag priority, creates the variant wrapper, returns the file path and insert line.
2. **Batch variant writes**: all variants in a single file edit instead of one per variant. Saves N-1 tool call round-trips.
3. **Page URL hint**: browser includes `location.pathname` in the generate event so the agent can map URL to source file directly.

Net effect: 4 tool calls (wrap + edit + read + reply) instead of 8+.

## Test coverage

- **26 wrap tests** (`tests/live-wrap.test.mjs`): unit tests for `buildSearchQueries`, `findElement`, `findClosingLine`, `detectCommentSyntax` + integration tests for full `wrapCli` on HTML and JSX fixtures.
- **15 server tests** (`tests/live-server.test.mjs`): integration tests that start a real server, test all endpoints, verify browser→agent event flow and agent→browser SSE delivery.

## Known limitations

- **Bun's static HTML import**: Bun's `import from "index.html"` caches at module load time. Source changes require a server restart to appear in the served HTML. The no-HMR fallback (fetch from `/source`) handles this, but it's less seamless than Vite/Next.js where HMR works natively.
- **Single generation at a time**: only one generate/cycle session can be active. This is by design (the source file can only have one variant wrapper at a time).
- **Inspection-only accept (v1)**: accepting a variant presents the code to the user and cleans up the scaffolding. Write-back (keeping the variant in place) is planned for v2.
- **No cancel during generation**: once the agent starts generating, it finishes all variants before the user can interact again.

## Future work

- **Write-back on accept**: instead of restoring the original after accept, keep the accepted variant as the new source.
- **Detect-to-fix flow**: clicking a detected anti-pattern pre-selects that element and pre-fills the action (e.g., "overused font" pre-fills "typeset").
- **Background poll for Claude Code**: use `run_in_background: true` to keep the main conversation free during the poll loop.
- **Streaming variants**: progressive reveal as the agent writes each variant (currently batched for speed).
