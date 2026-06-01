# Live E2E Regression Hunt

Status: WIP

## Summary

The broad LLM-backed live E2E failures reproduce on latest `main` with multiple providers, so they are not caused by the Svelte adapter feature branch and are not provider-specific. A focused history probe points to `e8e36651` (`Live mode: staged AI copy edits (#158)`) as the first commit where the representative fixture regresses.

The tested failure mode is the regular live flow:

1. Boot `vite8-react-plain`.
2. Run the LLM-backed live E2E path.
3. Steer succeeds.
4. Pick `h1.hero-title`.
5. Generate 3 variants.
6. Cycle to variant 2.
7. Accept variant 2.
8. Source cleanup reports `carbonize cleanup done on src/App.jsx`.
9. The test times out waiting for the accepted DOM selector to reappear outside Impeccable variant wrappers.

The timeout occurs at `tests/live-e2e.test.mjs:336`.

## Command Used

Each tested commit was checked out in detached HEAD mode, then run against a single representative LLM-backed fixture:

```bash
IMPECCABLE_E2E_ONLY=vite8-react-plain \
IMPECCABLE_E2E_AGENT=llm \
bun run test:live-e2e
```

Provider-specific results are intentionally omitted here because the failure reproduces with more than one provider.

## Results

| Commit | Description | Result |
| --- | --- | --- |
| `84135db0` | Add LLM-backed live E2E adapter (#163) | Pass |
| `9ffd3211` | Neo Kinpaku design system + Live Mode v3 (#169) | Pass |
| `92b744be` | Immediate parent of `e8e36651` | Pass |
| `e8e36651` | Live mode: staged AI copy edits (#158) | Fail |
| `6ef995f8` | fix(live): correct generation shader capture + halftone on dark/textured surfaces (#171) | Fail |
| `d6e39231` | Fix edit mode focus stealing (#172) | Fail |
| `e10cff39` | Fix live copy edit paragraph resizing (#178) | Fail |

This gives a clean boundary:

- Last known passing commit in the tested path: `92b744be`
- First known failing commit in the tested path: `e8e36651`

## Failure Details

On `e8e36651` and later, the test log reaches:

```text
Waiting for accept + carbonize cleanup to land
[agent] accept id=<id> variantId=2
[agent] carbonize cleanup done on src/App.jsx
```

Then it fails with:

```text
page.waitForFunction: Timeout 20000ms exceeded.
at tests/live-e2e.test.mjs:336:20
```

The failing assertion waits for at least one accepted DOM element matching the fixture selector, with no ancestor matching:

```text
[data-impeccable-variants],[data-impeccable-variant]
```

## Why `e8e36651` Is Suspect

`e8e36651` substantially changed the live runtime and test harness:

- `skill/scripts/live-browser.js`
- `skill/scripts/live-server.mjs`
- `skill/scripts/live-poll.mjs`
- `skill/scripts/live-accept.mjs`
- `skill/scripts/live-wrap.mjs`
- `tests/live-e2e.test.mjs`
- `tests/live-e2e/agent.mjs`
- `tests/live-e2e/agents/llm-agent.mjs`
- Manual edit buffer/apply/discard/evidence scripts

The new manual edit subtest passes on failing commits, but the original click -> Go -> cycle -> accept flow starts failing at the same commit. That suggests the regression is likely an interaction introduced by the staged copy-edit live runtime changes, not the LLM provider and not the later Svelte adapter work.

## Artifacts

Local artifacts from the run are under:

```text
tmp/main-live-e2e-regression-hunt-20260601-183958/
```

Important files:

- `92b744be_feat_site_new_Neo_Kinpaku_social_card_sitewide_OG_default_/output.log`
- `e8e36651_Live_mode_staged_AI_copy_edits_158_/output.log`
- `*/output.tail.txt`
- `*/result.txt`

These artifacts are local and intentionally not committed.

## Next Investigation Steps

1. Diff `92b744be..e8e36651` around source cleanup, live session state, browser wrapper removal, and post-accept HMR/reload behavior.
2. Re-run the failing fixture with extra DOM snapshots immediately after `carbonize cleanup done`.
3. Check whether the accepted source is valid but Vite/HMR fails to re-render, or whether the browser live runtime leaves/removes the expected DOM incorrectly.
4. Narrow inside `e8e36651` by temporarily reverting logical chunks:
   - manual edit browser additions,
   - server/session event changes,
   - accept/poll contract changes,
   - wrap/carbonize changes.
5. Keep Svelte adapter work separate; current evidence shows `vite8-sveltekit` passes on `main`, while broad non-Svelte fixtures fail on `main`.

## Resolution

The focused DeepSeek Playwright regression reproduced the exact boundary as: source cleanup was complete, all live variant markers were gone from `src/App.jsx`, but the browser had no clean `h1.hero-title` after accept. The live browser was treating the `/events` enqueue response as final accept confirmation, then clearing local session state before the post-carbonize completion signal and before Vite reliably remounted the accepted source.

The fix keeps accept in `SAVING` until an existing terminal server signal arrives (`complete`, or the current harness's post-cleanup `accept` reply). `agent_done` remains non-terminal for carbonize-required accepts. After terminal completion, the browser gives HMR a short window, unwraps the accepted variant if the wrapper is still present, restores from the accepted DOM snapshot if HMR removed the wrapper without mounting the accepted element, and finally reloads from the now-clean source only if the accepted DOM is still missing.
