---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
title: "fix: hooks reset no longer re-arms a disabled hook"
type: fix
created: 2026-08-10
origin: "https://github.com/pbakaus/impeccable/issues/512"
---

# fix: hooks reset no longer re-arms a disabled hook

**Target repo:** pbakaus/impeccable (working from fork `SomSamantray/impeccable`, branch `fix/512-hooks-reset-rearms-disabled-hook`)

---

## Summary

`hooks off` correctly disables Impeccable's PostToolUse/Stop hook. Running `hooks reset` afterward silently re-enables it: `reset()` deletes the config file (including the `enabled: false` the user set) but never touches the hook manifests it wrote into `.claude/settings.json`, `.codex/hooks.json`, `.cursor/hooks.json`, or `.github/hooks/impeccable.json`. Because `DEFAULT_CONFIG.enabled` defaults to `true`, the next config read treats the missing key as "on," and the surviving manifest entries fire again. A deliberate opt-out does not survive a reset — issue [#512](https://github.com/pbakaus/impeccable/issues/512).

## Problem Frame

- **R1: Reset must not re-enable a previously disabled hook.** After `hooks off` then `hooks reset`, the effective state must be disabled, not enabled.
- **R2: Reset must fully remove installed manifest entries.** `reset()` currently deletes config/cache/pending files but leaves every provider's manifest (`.claude/settings.json` or `.claude/settings.local.json`, `.codex/hooks.json`, `.cursor/hooks.json`, `.github/hooks/impeccable.json`) untouched, so the hook keeps running even though the user asked for a clean slate.
- **R3: Absence of any config must mean "not consented," not "on."** A fresh checkout with no consent record currently reports `enabled` (the milder symptom the issue also names) — `DEFAULT_CONFIG.enabled` should default to `false`, matching the model that only an explicit `hooks on` (with its consent record) turns the hook on.

## Key Technical Decisions

**KTD1: Flip `DEFAULT_CONFIG.enabled` to `false`.** In `skill/scripts/hook-lib.mjs`, `DEFAULT_CONFIG.enabled` currently defaults to `true`; only `hooks on` should produce an enabled state, and it already writes `enabled: true` explicitly (`setEnabled(cwd, true)` in `skill/scripts/hook-admin.mjs`). The source-of-truth field is only ever overridden when the raw config file actually has an `enabled` key: `applyConfigSource()` in `hook-lib.mjs` (invoked from `readConfig()`) does `if (Object.prototype.hasOwnProperty.call(raw, 'enabled')) { config.enabled = raw.enabled === false ? false : true; }`. So a fresh or reset repo (no `enabled` key on disk) now correctly falls through to the new `false` default, while every existing explicit `hooks on`/`hooks off` write is unaffected.

**This default flip has a wider blast radius than the line-count suggests — see U1 below.** `runHook()`/`runStopHook()` (`hook-lib.mjs` ~line 1691-1694 and ~2053-2056) gate on `if (config.enabled === false) return result({ skipped: 'config-disabled', ... })`. `tests/hook.test.mjs` has roughly a dozen `describe` blocks whose `beforeEach` calls the shared `mkTmp()` helper (a bare `fs.mkdtempSync`, no config written) and then exercises `runHook()`/`runStopHook()` directly — those tests currently reach real scan/dedupe/render/cache logic only because the old `true` default carries them past the enabled-gate. Flipping the default without also fixing those fixtures would make every one of them short-circuit to `skipped: 'config-disabled'` and fail. U1's test-file changes are scoped to cover this, not just the `readConfig()` assertions.

**KTD2: `reset()` prunes impeccable's entries from every installed manifest target, reusing the existing `repairHookManifests()` machinery.** `hook-admin.mjs` already has everything needed: `HOOK_MANIFEST_TARGETS` (the list of provider manifest paths), and `pruneImpeccableHookFromManifest(manifestPath)` (verified at `hook-admin.mjs` lines 512-545: returns `false` immediately if the file has no impeccable marker or fails to parse, otherwise strips impeccable's entries — deleting the file outright if nothing else remains, or rewriting it — and returns `true`; sibling entries and unrelated keys are preserved via `stripImpeccableHookEntries`, already covered by the existing "unrelated local hook fields survive" test pattern). `repairHookManifests()` calls `pruneImpeccableHookFromManifest()` today only as a side effect of re-installing (when a shared manifest already carries the marker). `reset()` needs the same prune applied unconditionally, for both `target.destRel` and `target.sharedDestRel` when present, regardless of whether the skill folder (`target.skillRel`) still exists — a user may be resetting during an uninstall, so gating on `skillRel` presence (as `repairHookManifests()` does before writing) would skip exactly the manifests that most need cleanup.

**KTD3: `reset()`'s return message reports pruned manifests alongside removed config/cache files.** Mirrors the existing `setEnabled()` messaging convention (`Installed or repaired hook manifests for: ...`) so `reset` is not silently different in verbosity from `on`/`off`.

## Scope Boundaries

**In scope:** `DEFAULT_CONFIG.enabled` default; `reset()` manifest pruning; message text; new/updated tests in `tests/hook.test.mjs`.

**Out of scope (not touched by this fix):**
- `repairHookManifests()`'s own logic and its `skillRel`-gated install path — unchanged.
- Any other `hook-admin.mjs` action (`on`, `off`, `ignore-rule`, `ignore-file`, `ignore-value`, `status`) beyond reading the new default.
- The two milder pre-existing behaviors the issue mentions only as context (fresh-checkout wording, consent-record semantics) beyond what KTD1 already fixes.

---

## Implementation Units

### U1. Default to disabled absent explicit consent

**Goal:** `DEFAULT_CONFIG.enabled` becomes `false`, so any config state lacking an explicit `enabled` key (fresh checkout, or post-reset) reports and behaves as disabled.

**Requirements:** R3 (KTD1)

**Dependencies:** none

**Files:**
- `skill/scripts/hook-lib.mjs` — change `DEFAULT_CONFIG.enabled: true` (line 151) to `false`.
- `tests/hook.test.mjs` — two categories of change:
  1. Update `readConfig()` tests that assert the bare/no-config default is `enabled === true` (around line 220, `describe('readConfig()')`) to assert `false` instead.
  2. Add a shared `mkEnabledTmp()` helper next to the existing `mkTmp()` (line 68) that creates the tmp dir and writes `.impeccable/config.json` with `{ hook: { enabled: true } }`. Swap `cwd = mkTmp()` for `cwd = mkEnabledTmp()` in the `beforeEach` of every describe block that exercises `runHook()`/`runStopHook()` without itself writing an explicit `enabled` value — confirmed at minimum: `runHook()` (~1295), `runHook() — cache write gating` (~1902), `runHook() — oversized files` (~1991), `runHook() — the session cache tracks the current scan` (~2105), `runHook() — clean-ack noise` (~2198), `runHook() — co-located stylesheet scan` (~2674), `runHook() — events without file_path` (~2839), `runHook() — configured template extensions` (~2860), `runHook() — emission enrichment` (~3340), `runHook() — per-edit tiering` (~3373), `runStopHook()` (~3494). Verify `expandScanTargets()` (~2602), `resolveProjectPlatform()/isNativePlatform()` (~2945), and `Cursor hook scripts` (~2970) against the same criterion — swap only if their tests call `runHook()`/`runStopHook()` on the bare fixture.

**Approach:**
- The `DEFAULT_CONFIG.enabled` change itself is one line. `applyConfigSource()` (hook-lib.mjs, invoked from `readConfig()`) already only overrides `config.enabled` when the raw file has an own `enabled` property, so this change only affects the fallback path, not any explicit `true`/`false` write.
- The real scope is the test-fixture update: `runHook()`/`runStopHook()` (hook-lib.mjs ~1691-1694, ~2053-2056) short-circuit to `skipped: 'config-disabled'` when `config.enabled === false`. Every describe block listed above currently reaches real scan/dedupe/render/cache logic only because the old `true` default carried bare `mkTmp()` fixtures past that gate — without the `mkEnabledTmp()` swap, this unit breaks the bulk of the existing `runHook`/`runStopHook` suite rather than just the four `readConfig()` cases originally scoped.
- Do NOT change `mkTmp()` itself — the `hook-admin.mjs` describe block (~654) and the `readConfig()` describe block (~213) both rely on `mkTmp()` returning a truly bare, config-less directory to exercise the new disabled-by-default behavior; a global default would defeat that.

**Patterns to follow:** existing `readConfig()` describe block (`tests/hook.test.mjs` ~line 213) already tests default vs. explicit-`true` vs. explicit-`false` cases; extend those, don't restructure them. The existing `writeFixture`/helper-function style at the top of each describe block (e.g. `runHook()`'s own local helpers ~1298-1341) is the pattern for adding `mkEnabledTmp()` as a shared top-of-file helper rather than a per-block one.

**Test scenarios:**
- `readConfig()` on a cwd with no `.impeccable/config.json` at all returns `enabled: false` (was `true`).
- `readConfig()` with an explicit `{ hook: { enabled: true } }` still returns `enabled: true` (regression guard — explicit `on` must still work).
- `readConfig()` with an explicit `{ hook: { enabled: false } }` still returns `enabled: false`.
- `hooks status` on a completely fresh cwd (no config, no manifests) reports disabled, not enabled — covers the issue's "milder symptom."
- Every `runHook()`/`runStopHook()` describe block swapped to `mkEnabledTmp()` continues to pass unmodified otherwise — i.e., the swap alone (no other test-body change) restores prior behavior, confirming the fixtures were the only thing relying on the old default.

**Verification:** existing `readConfig()` suite and a fresh-checkout `status` assertion pass with the new default; the full `tests/hook.test.mjs` suite passes after the `mkEnabledTmp()` swap, confirmed via full suite run in U3 rather than assumed from a partial read.

---

### U2. `reset()` prunes impeccable entries from every installed manifest

**Goal:** `hooks reset` removes impeccable's hook entries from `.claude/settings.json`/`.claude/settings.local.json`, `.codex/hooks.json`, `.cursor/hooks.json`, and `.github/hooks/impeccable.json` — whichever exist — in addition to the config/cache/pending cleanup it already does.

**Requirements:** R1, R2 (KTD2, KTD3)

**Dependencies:** none (independent of U1; both land in the same commit since they fix the same issue)

**Files:**
- `skill/scripts/hook-admin.mjs` — extend `reset(cwd)` (currently ~line 742) to loop `HOOK_MANIFEST_TARGETS` and call `pruneImpeccableHookFromManifest()` for each target's `destRel` and `sharedDestRel` (when defined), collecting which providers were actually pruned; fold that into the returned message.
- `tests/hook.test.mjs` — add a `reset` test block near the existing `hook-admin.mjs` describe (~line 654) using the same fixture pattern as "hooks on accepts declined consent and installs missing provider manifests" (~line 917): create provider skill dirs, write manifest files containing impeccable's hook entries, then run `reset` and assert those entries are gone while sibling entries and unrelated keys survive.

**Approach:**
- In `reset(cwd)`, after the existing config/cache/pending removal loops, add: for each `target` in `HOOK_MANIFEST_TARGETS`, for each of `[target.destRel, target.sharedDestRel].filter(Boolean)`, resolve the absolute path and call `pruneImpeccableHookFromManifest(absPath)`; track providers where it returned a truthy prune (per its existing return contract — see `pruneImpeccableHookFromManifest`'s current callers) in a `prunedManifests` list.
- Do **not** gate this loop on `fs.existsSync(path.join(cwd, target.skillRel))` the way `repairHookManifests()` gates its install path — `pruneImpeccableHookFromManifest()` already no-ops safely on a missing/markerless file (`if (!fileHasImpeccableHookMarker(manifestPath)) return false;`), and gating on the skill folder would skip cleanup during an uninstall, which is exactly when a full manifest prune matters most.
- Extend the returned message: when `prunedManifests.length > 0`, append `Removed hook entries from: <providers>.` to the existing removed-files sentence (mirrors the `setEnabled()` message-composition style at hook-admin.mjs ~line 376-390 — build a `parts` array and `join(' ')`, rather than a single template string, so this stays easy to extend).
- Reuse `pruneImpeccableHookFromManifest` and `HOOK_MANIFEST_TARGETS` exactly as they exist for `repairHookManifests()` — no signature changes to either.

**Technical design** (directional, not literal code):
```
function reset(cwd) {
  const removed = [...existing config/cache/pending removal...]
  const prunedManifests = []
  for (const target of HOOK_MANIFEST_TARGETS) {
    let prunedThisTarget = false
    for (const rel of [target.destRel, target.sharedDestRel].filter(Boolean)) {
      if (pruneImpeccableHookFromManifest(path.join(cwd, rel))) prunedThisTarget = true
    }
    if (prunedThisTarget) prunedManifests.push(target.provider)
  }
  ...compose message including prunedManifests...
}
```

**Patterns to follow:** `repairHookManifests()`'s own `HOOK_MANIFEST_TARGETS` loop (hook-admin.mjs ~line 393-429) for target iteration; `setEnabled()`'s `parts.push(...)` message-composition style (~line 376-390) for the returned string; the "hooks on ... installs missing provider manifests" test (~line 917-957) for fixture shape (per-provider skill dirs, manifest files with pre-existing entries, asserting exact post-command manifest contents).

**Test scenarios:**
- **Happy path:** fixture with `.claude` skill folder + `.claude/settings.local.json` containing an impeccable PostToolUse+Stop entry alongside an unrelated `OtherTool` entry (same shape as the existing "hooks on" test). Run `off` then `reset`. Assert: impeccable's entries are gone from the manifest, the unrelated `OtherTool` entry survives, and `hooks status` afterward reports disabled (not just "no config" — actually re-read via `readConfig`/`status` to close the loop end-to-end).
- **Multi-provider:** fixture with all four providers (`.claude`, `.agents`/`.codex`, `.cursor`, `.github`) installed via `on` first, then `reset`. Assert each of the four manifest files either has its impeccable entries stripped or (for providers whose manifest becomes empty) matches `pruneImpeccableHookFromManifest`'s existing empty-file behavior (delete `hooks`/`description`/`version` keys, or remove the file entirely if nothing remains — per current `pruneImpeccableHookFromManifest` behavior, don't re-specify it, just assert on it).
- **Sibling entries survive:** a manifest with both an impeccable entry and an unrelated tool's entry — after `reset`, only the unrelated entry remains (regression guard mirroring the existing "on" test's `local-hook.mjs` assertion).
- **Edge case — no manifests installed:** fixture with only a config file (no provider skill dirs, no manifest files) — `reset` behaves exactly as before (removes config/cache/pending, no crash, no spurious "Removed hook entries from" clause since `prunedManifests` stays empty).
- **Edge case — manifest present but has no impeccable marker:** a `.claude/settings.local.json` with only unrelated hooks — `reset` leaves it byte-for-byte unchanged (guards against `pruneImpeccableHookFromManifest` being invoked destructively on unrelated files).
- **Edge case — skill folder absent, manifest still present (the case KTD2's unconditional-loop decision exists for):** fixture with the impeccable-tagged manifest entries in `.claude/settings.local.json` but no `.claude/skills/impeccable` skill folder on disk (simulating mid-uninstall: skill files removed, manifest not yet cleaned). Assert `reset` still prunes the manifest — proving the loop is correctly *not* gated on `target.skillRel` existence the way `repairHookManifests()`'s install path is.
- **Integration — full revocation survives reset (covers the issue's own repro):** replay the issue's exact sequence — `on` → `off` → `reset` → `status` — and assert the final `status` output reports disabled, matching the issue's "Applied locally as a stopgap" expected final state.

**Verification:** the multi-provider and full-revocation-sequence scenarios above directly reproduce and close the issue's own repro steps; existing "hooks on" test continues to pass unmodified (no shared code path was changed for `on`/`repairHookManifests`).

---

### U3. Full suite verification

**Goal:** confirm the two changes compose correctly and nothing else in the existing suite assumed the old `enabled: true` default.

**Requirements:** R1, R2, R3

**Dependencies:** U1, U2

**Files:** none (verification only)

**Approach:**
- Run the full test suite (`tests/hook.test.mjs` at minimum, plus whatever the repo's standard test command covers) and confirm no unrelated test broke on the `DEFAULT_CONFIG.enabled` flip — the `hooks on` test at line 917 and the "quiet flag survives on/off toggle" test at line 900 both write explicit `enabled`/`quiet` values, so they should be unaffected, but must be re-run to confirm.

**Test expectation:** none beyond what U1/U2 already specify — this unit is a full-suite regression check, not new behavior.

**Verification:** full test suite green; manual `hooks on` → `off` → `reset` → `status` sequence (in a scratch directory with provider skill folders present) matches the issue's expected final state: disabled, config/cache/pending removed, manifest entries removed.

---

## Verification Contract

- `readConfig()` / `status` on a config-less cwd reports `enabled: false`.
- `hooks on` still results in `enabled: true` and installed manifests (unchanged behavior — regression-guarded by the existing test at line 917).
- `hooks off` still results in `enabled: false` (unchanged — regression-guarded by the existing test at line 900).
- `hooks reset` after `hooks off`: manifests across all installed providers lose their impeccable entries; sibling/unrelated manifest entries and keys survive; `hooks status` afterward reports disabled.
- `hooks reset` on a cwd with no manifests installed: unchanged behavior (config/cache/pending removed, no error).

## Definition of Done

- [ ] U1: `DEFAULT_CONFIG.enabled` is `false`; `readConfig()` tests updated; every `runHook()`/`runStopHook()` fixture that relied on the old default is swapped to `mkEnabledTmp()` and still passes.
- [ ] U2: `reset()` prunes impeccable entries from all `HOOK_MANIFEST_TARGETS` manifests; new tests covering happy path, multi-provider, sibling-survival, no-manifest, no-marker, skillRel-absent, and full-revocation-sequence scenarios all pass.
- [ ] U3: full test suite green; manual repro of the issue's exact sequence confirms final state is disabled.

## Review Notes (headless ce-doc-review, round 1)

Three personas ran (coherence, feasibility, adversarial — `product-lens`/`design-lens`/`security-lens`/`scope-guardian` did not activate; greenfield plan with no upstream Product Contract source, `Origin: none`). All actionable findings (confidence ≥65) were applied directly above:
- **Feasibility (P0, confidence 100):** U1 as originally scoped would break ~13 existing `runHook()`/`runStopHook()` test blocks relying on the old `enabled: true` default. Verified against `hook-lib.mjs` and `tests/hook.test.mjs` directly — confirmed real. Fixed by expanding U1 to add `mkEnabledTmp()` and swap it into the affected fixtures.
- **Feasibility (P3, confidence 75):** KTD1 cited a nonexistent `mergeHookConfig` in `hook-lib.mjs`; the real hasOwnProperty-gated function is `applyConfigSource()`. Corrected the citation.
- **Coherence (P2, confidence 65):** U2's test scenarios never covered the skillRel-absent case that KTD2's unconditional-loop decision is specifically justified by. Added that scenario.
- **Adversarial (P1, confidence 75):** KTD2 asserted `pruneImpeccableHookFromManifest`'s return contract without citing it. Verified the function directly (lines 512-545) and cited its confirmed true/false behavior in KTD2.
- **Coherence (P3, confidence 50, FYI — not applied):** flagged the `.agents`/`.codex` notation in U2's multi-provider scenario as inconsistent-looking. Left as-is: it accurately reflects that the codex provider's `HOOK_MANIFEST_TARGETS` entry has a different `skillRel` (`.agents/skills/impeccable`) from its `destRel` (`.codex/hooks.json`), unlike the other three providers where both paths share a top-level directory.
