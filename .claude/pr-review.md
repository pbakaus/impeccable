# PR Review — feat(live): manual text-edit panel

- PR: [pbakaus/impeccable#158](https://github.com/pbakaus/impeccable/pull/158) (mirror: [abdulwahabone/impeccable#2](https://github.com/abdulwahabone/impeccable/pull/2))
- Branch: `feat/live-manual-text-edit`
- HEAD at review: `dbaa5d5c` ("feat(live): Make mixed-content paragraphs editable")
- Reviewed: 2026-05-17

The PR has 188 changed files; 175 are auto-generated harness mirrors. Real source diff is ~1,450 LOC across 13 files under `skill/scripts/` and `skill/reference/`.

---

## Cursor Bugbot findings

Pulled from PR #158 review comments (`gh api repos/pbakaus/impeccable/pulls/158/comments`). Seven findings; one (HIGH) is already resolved on the branch.

### CB-1 — Locator uses container's classes but child's tag — **RESOLVED**

- Severity: High
- Path: `skill/scripts/live-browser.js` (was line 1760 on commit `e31f4890`)
- Status: **Fixed** by commit `a80c5636` ("Manual edit ops use the leaf element's locator, not parent's") and hardened by `d28fa17f` ("Climb to nearest classed ancestor when leaf has no locator"). Current code uses `buildLocatorForLeaf(row.el, selectedElement)` at [skill/scripts/live-browser.js:1696-1721](skill/scripts/live-browser.js#L1696-L1721), which derives the locator from the leaf and climbs to the nearest classed ancestor if needed.
- Original Cursor finding:

  > In `applyEditing()`, each op uses `selectedElement.id` and `selectedElement.classList` (the picked container) for the locator but `row.el.tagName` (the child text-leaf) for the tag. When `live-edit.mjs` runs `buildSearchQueries` with, say, `classes='hero'` and `tag='h2'`, it searches for an `<h2>` element carrying class "hero" — which doesn't exist because "hero" belongs to the parent container.

### CB-2 — Escape reverts DOM but stale draft persists for Apply — **OPEN**

- Severity: Medium
- Path: [skill/scripts/live-browser.js:2895-2901](skill/scripts/live-browser.js#L2895-L2901)
- Cursor's finding:

  > When Escape is pressed in a contenteditable field, `e.target.innerText = original` reverts the DOM text but `inlineEditDrafts` retains the stale pre-revert value. Programmatic `innerText` assignment doesn't fire the `input` event, so `onInlineInput` never updates the map. If the user then clicks Apply, `applyEditing()` reads the stale draft from `inlineEditDrafts.get(row.el)`, sees it differs from `row.text`, and sends the reverted edit to source — saving changes the user explicitly undid.

- Fix sketch: after restoring `innerText`, delete the entry: `inlineEditDrafts.delete(e.target)`. Or compare against current `innerText` at apply time rather than the stored draft.

### CB-3 — Tautological scrub condition — **OPEN**

- Severity: Medium (Cursor flagged this twice — once Low, once Medium)
- Path: [skill/scripts/live-accept.mjs:98-99](skill/scripts/live-accept.mjs#L98-L99)
- Cursor's finding:

  > The condition `!result.handled || result.handled !== false` is a tautology — it evaluates to `true` for every possible value of `result.handled`. When `handled` is `false`, `!false` short-circuits the OR to `true`, so the scrub runs even when the accept failed and the file wasn't modified. The likely intent was `result.handled !== false`.

- Verified: for `handled ∈ {true, false, undefined}` the expression is always `true`. In practice impact is bounded because a failed accept leaves the file unchanged, but the gate is wrong and misleading.

### CB-4 — Buffer-aware wrap doesn't filter by pageUrl — **OPEN**

- Severity: Medium
- Path: [skill/scripts/live-wrap.mjs:211-220](skill/scripts/live-wrap.mjs#L211-L220)
- Cursor's finding:

  > The buffer-aware "original" content replacement iterates over ALL buffer entries without filtering by `pageUrl`. If a manual edit on page A changes text that also appears in a different element on page B, wrapping that element on page B would incorrectly apply page A's edit to the wrap block's "original" variant content.

- Verified: the loop is `for (const entry of buffer.entries)` with no `if (entry.pageUrl !== currentPage) continue;` guard. `live-wrap.mjs` has no `--page-url` arg today; the call site would need to pass it through, or the wrap would need to read it from a contextual source.

### CB-5 — Discard returns inconsistent count units — **OPEN**

- Severity: Medium
- Path: [skill/scripts/live-discard-manual-edits.mjs:38-44](skill/scripts/live-discard-manual-edits.mjs#L38-L44)
- Cursor's finding:

  > The `discarded` value has inconsistent semantics depending on the code path. When `pageUrlFilter` is set, `removeEntries` returns the number of *entries* removed. When no filter is set, `truncateBuffer` returns the number of *ops* removed. Since entries can contain multiple ops, the output `{ discarded, totalCount }` reports different units. The UI pill counts ops, so the page-scoped path undercounts.

- Verified. Fix sketch: have `removeEntries` count and return ops removed, or convert at call site.

### CB-6 — File reconstruction drops leading empty line — **OPEN**

- Severity: Low
- Path: [skill/scripts/live-edit.mjs:191-196](skill/scripts/live-edit.mjs#L191-L196)
- Cursor's finding:

  > In `applyTextReplace`, the expression `(before ? before + '\n' : '')` uses string truthiness to decide whether to prepend content. When `startLine` is 1 and line 0 is empty (file starts with `\n`), `before` equals `[''].join('\n')` which is `''` — falsy. This silently drops the leading empty line from the reconstructed file, causing data loss.

- Fix sketch: change to `(startLine > 0 ? before + '\n' : '')` to mirror the symmetric handling on the `after` side.

---

## Additional findings (review pass on top of Cursor)

### Critical (bugs / data integrity)

**A1 — PR description is stale relative to the code.**
The summary describes a `blur`-driven save flow (`onInlineBlur`, `inlineSavePromise`, "Save on blur, exit on success," "Generate waits for pending save"). None exist in the current diff. Save is button-driven (`enterEditingMode` → Edit badge → Save/Cancel). Rewrite before merge so reviewers and future maintainers don't chase ghosts.

**A2 — Stale comment in keydown handler.**
[skill/scripts/live-browser.js:2899](skill/scripts/live-browser.js#L2899):
```
e.target.blur(); // blur sees no change → onInlineBlur no-ops
```
`onInlineBlur` doesn't exist. Remove or rewrite.

**A3 — `applyTextReplace` picks first `indexOf` match in the element block.**
[skill/scripts/live-edit.mjs:188-190](skill/scripts/live-edit.mjs#L188-L190). If the picked element contains the same text twice (two `<li>Item</li>`, repeated boilerplate), the first occurrence is replaced regardless of which leaf the user actually edited. The walker emits one row per text leaf so it knows *which* node; that information is lost by the time we hit source. Either re-resolve the leaf by descending into the matched block using the `ref` path (`ul>li.2` → 2nd `<li>` inside the `<ul>`), or refuse with `text_ambiguous_in_block` when originalText appears more than once.

**A4 — Unsanitized `newText` is substituted verbatim into source.**
Same code path. If a user types `</p>`, `<script>`, `<%`, `{`, or other HTML/JSX-significant characters in an editable leaf, those land in source as a literal substring. HTML files break; JSX/TSX hits a parse error on the next dev-server reload. No escape or validation layer. Minimum mitigation: reject `newText` containing `<`, `>`, `{`, `}` (or backticks for JSX) server-side.

**A5 — `webkitUserModify: 'read-write-plaintext-only'` is Safari-only.**
[skill/scripts/live-browser.js:109](skill/scripts/live-browser.js#L109). In Firefox/Chrome/Edge/Brave/Arc this has no effect — paste delivers rich text, `innerText` partially flattens it, and surprises (non-breaking spaces, newlines) survive to disk. Add a `paste` handler that calls `e.preventDefault()` and inserts `e.clipboardData.getData('text/plain')` at the caret in `enableInlineEdit`.

### Important

**A6 — Coverage gap on new orchestration code.**
New tests exist for `live-edit.mjs` (8 cases, [tests/live-edit.test.mjs](tests/live-edit.test.mjs)) and `live-text-rows.js` (11 cases, [tests/live-text-rows.test.mjs](tests/live-text-rows.test.mjs)) — clean. But untested:

- `live-manual-edits-buffer.mjs` (merge-by-(pageUrl,ref), `removeOp`, `truncateBuffer`, `findOp`)
- `live-commit-manual-edits.mjs` (partial-failure preservation, buffer rewrite, failed-refs filter at line 87)
- `live-discard-manual-edits.mjs` (the count-units bug CB-5 would have been caught here)
- `/manual-edit-stash`, `/manual-edit-commit`, `/manual-edit-discard` HTTP routes
- Buffer-aware wrap in `live-wrap.mjs` (CB-4 would have been caught here)
- `scrubManualEditsAgainstFile` in `live-accept.mjs` (CB-3 would have been caught)
- Astro `is:inline` injection branch in `live-inject.mjs`

The buffer module is pure and trivial to unit-test. Most of these would be one fixture each.

**A7 — `applyEditing()` has no in-flight guard.**
[skill/scripts/live-browser.js:446-454](skill/scripts/live-browser.js#L446-L454). Save button has no debounce or `disabled = true` during the await. Double-click fires two POSTs. Merge-by-ref makes it idempotent for identical text but the UI flashes and re-enables mid-request. Set a `savingInFlight = true` flag.

**A8 — `SKIP_SUBTREE_TAGS` is duplicated in two files.**
[skill/scripts/live-text-rows.js:14-16](skill/scripts/live-text-rows.js#L14-L16) and `MIXED_WRAP_SKIP` in [skill/scripts/live-browser.js:55](skill/scripts/live-browser.js#L55). Same set, no shared source. Drift produces inconsistent wrap vs. collect behavior. Expose one as `window.__IMPECCABLE_LIVE_TEXT_ROWS__.SKIP_SUBTREE_TAGS` and import.

**A9 — `scrubManualEditsAgainstFile` heuristic can drop or keep wrong ops.**
[skill/scripts/live-accept.mjs:120-135](skill/scripts/live-accept.mjs#L120-L135). Scrubs any buffer op whose `originalText` no longer appears in the accepted file. False-keep: a short common phrase ("Read more") shared across elements survives a scrub it shouldn't, so commit could land on the wrong shadow. False-drop: rare, but a substring match elsewhere in source masks a legitimately-stale op. Record the wrap block's line range before accept and scrub by intersection, or document the tradeoff clearly.

**A10 — `exitTimer` doesn't account for `/manual-edit-stash` POSTs.**
[skill/scripts/live-server.mjs:545-551](skill/scripts/live-server.mjs#L545-L551). When the last SSE client disconnects, an 8s exit timer fires. Manual-edit endpoints use plain POST and don't `clearTimeout(state.exitTimer)`. A POST that arrives during that 8s window can be cut off by shutdown. Have all `/manual-edit-*` handlers clear the timer.

**A11 — Token transport is inconsistent across endpoints.**
GET `/manual-edit-stash` → query string. POST → JSON body. POST `/manual-edit-commit` and `/manual-edit-discard` → query string. Pick one convention (query matches `/poll`, `/source`, `/annotation`) and eliminate a class of silent 401s from wrong-format requests.

**A12 — `confirm()` blocks the main thread.**
[skill/scripts/live-browser.js:310](skill/scripts/live-browser.js#L310) and [:340](skill/scripts/live-browser.js#L340). The pending-pill Apply and Discard each gate on native `confirm()`. While it's open the live overlay (animations, SSE handling, picker) is frozen. The codebase already has `showToast` and styled banners — use those.

### Advisory

- **A13** — Recursion in `hasTextRows` / `wrapMixedContentTextNodes` is unbounded. Switch to iterative stack-walks to remove the cliff on pathological DOMs.
- **A14** — `inlineEditDrafts` and `inlineEditRows` reassigned via `let` could be `const` with `.clear()` / `.length = 0`. Stylistic.
- **A15** — `/manual-edit` legacy 410 redirect ([skill/scripts/live-server.mjs:669-673](skill/scripts/live-server.mjs#L669-L673)) is good for one release cycle. Mark removal target.
- **A16** — Two `<style>` injections into the host document head (focus-ring overrides). Namespaced via `#impeccable-edit-badge` prefix so collisions are unlikely, but document the host-page mutation next to other globals.
- **A17** — `result.failed` shape differs between `live-edit.mjs` and `live-commit-manual-edits.mjs`. The commit script wraps shell errors as `{ id, pageUrl, reason, message }` and forwards edit failures as `{ ...f, id, pageUrl }`. Pick one normalized shape.
- **A18** — Op schema is informally documented in three places (`live-edit.mjs` header comment, `live-server.mjs` validator, `live-manual-edits-buffer.mjs` merge). A `// @typedef Op = ...` JSDoc would catch drift in editors.

---

## What's solid

- Tests for the *new locator and walker logic* are clean and cover ambiguity correctly (id-only locator, classes-only locator, disambiguation by text, multi-file, text-not-in-source).
- Buffer-aware wrap design in [live-wrap.mjs:208-223](skill/scripts/live-wrap.mjs#L208-L223) is the right model — pending edits become the "current truth" for downstream variant operations. (Just needs CB-4's pageUrl filter.)
- Astro `is:inline` fix in [live-inject.mjs:259-264](skill/scripts/live-inject.mjs#L259-L264) is correctly scoped to `.astro` files.
- `confirm-before-apply` on the pending pill is the right default — manual edits to source should be intentional. (UX could move off native `confirm`, see A12.)
- `MAX_ANNOTATION_BYTES` 10MB cap is a sensible defensive bound.
- Reuse of `findOpenerLine` / `findClosingLine` / `findFileWithQuery` from `live-wrap.mjs` in `live-edit.mjs` is good factoring.
- Locator fix in `a80c5636` + `d28fa17f` (CB-1) is exactly right — climbs to nearest classed ancestor when the leaf has neither id nor classes.

---

## Recommended action order before merge

1. Rewrite the PR description to match the actual button-driven save model (A1).
2. Fix the data-loss / corruption paths:
   - CB-2 (Escape clears DOM but stale draft survives)
   - CB-6 (leading-empty-line drop)
   - A3 (first-`indexOf` replaces wrong duplicate)
   - A4 (HTML-escape or reject special chars in `newText`)
3. Fix the page-scoping bugs:
   - CB-4 (buffer-aware wrap iterates all pages)
   - CB-5 (discard count units mismatch)
4. Fix the tautological gate (CB-3).
5. Sweep A2 + A8 (stale comment, duplicated tag list).
6. Add tests for `live-manual-edits-buffer`, `scrubManualEditsAgainstFile`, and the three manual-edit HTTP routes (A6).
