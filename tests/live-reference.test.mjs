import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

describe('live reference authoring contract', () => {
  it('keeps the live prompt focused on the foreground poll loop', () => {
    const liveMd = readFileSync(join(ROOT, 'skill/reference/live.md'), 'utf-8');
    const openingContract = liveMd.split('\n').slice(0, 60).join('\n');

    assert.match(liveMd, /1\. `live\.mjs`: boot\./);
    assert.match(liveMd, /3\. Poll loop with the default long timeout \(600000 ms\)\. After every event or `--reply`, run `live-poll\.mjs` again immediately\. Never pass a short `--timeout=`\./);
    assert.match(openingContract, /## Poll loop/);
    assert.match(openingContract, /No step skipped, no step reordered\./);
    assert.doesNotMatch(liveMd, /live-copy-edits\.md/);
    assert.match(liveMd, /\/manual-edit-stash/);
    assert.match(liveMd, /\/manual-edit-commit/);
    assert.match(liveMd, /live-commit-manual-edits\.mjs/);
    assert.match(liveMd, /Staged op shape/);
    assert.match(liveMd, /Commit result shape/);
    assert.match(liveMd, /nearbyEditableTexts/);
    assert.doesNotMatch(liveMd, /IMPECCABLE_LIVE_COPY_AGENT|mock/);
    assert.ok(
      liveMd.indexOf('## Manual copy edits') > liveMd.indexOf('## Handle `prefetch`'),
      'event=live_reference.copy_edit_pointer_order actor=agent operation=read_live_docs risk=manual_copy_edits_interrupt_core_event_loop expected=after_prefetch actual=before_prefetch',
    );
    assert.ok(
      liveMd.indexOf('## Manual copy edits') < liveMd.indexOf('## Exit'),
      'event=live_reference.copy_edit_pointer_order actor=agent operation=read_live_docs risk=copy_edit_pointer_drifts_into_cleanup expected=before_exit actual=after_exit',
    );
    assert.match(liveMd, /"manual_edit_apply"\s+→ Handle Manual Edit Apply/);
    assert.match(liveMd, /## Handle `manual_edit_apply`/);
    assert.ok(
      liveMd.indexOf('## Handle `manual_edit_apply`') > liveMd.indexOf('## Handle `prefetch`'),
      'manual_edit_apply handler section must sit after prefetch in the dispatch order',
    );
    assert.ok(
      liveMd.indexOf('## Handle `manual_edit_apply`') < liveMd.indexOf('## Manual copy edits'),
      'manual_edit_apply handler section must precede the Manual copy edits lifecycle reference',
    );
    // The opening contract must advertise manual_edit_apply so a polling agent
    // is never ambushed by an event the contract never mentioned.
    assert.match(openingContract, /On `manual_edit_apply`:/);
    assert.match(openingContract, /the user already clicked Apply, so do not ask what to do/);
    // The handler must document the real reply mechanism: --reply ... --data <json>.
    // This is the linchpin that was previously documented but unimplemented.
    assert.match(liveMd, /--reply EVENT_ID done --data '\{"status":"done"/);
    assert.match(liveMd, /--reply EVENT_ID done --data '\{"status":"partial"/);
    assert.match(liveMd, /--reply EVENT_ID done --data '\{"status":"error"/);
    assert.match(liveMd, /--reply done --file src\/page\.html/);
    assert.match(liveMd, /Use `--reply EVENT_ID done --data \.\.\.` for manual Apply/);
    assert.match(liveMd, /"status":"applied","entries":3/);
    assert.match(liveMd, /invalid_manual_apply_result/);
    assert.match(liveMd, /recovery shim for exact legacy summaries only/);
    assert.match(liveMd, /Mismatched or incomplete summaries are rejected/);
    assert.match(liveMd, /full `status`, `appliedEntryIds`, `failed`, `files`, and `notes` arrays/);
    assert.match(liveMd, /evidencePath/);
    assert.match(liveMd, /poll event is intentionally compact/);
    assert.match(liveMd, /read `evidencePath`/);
    assert.match(liveMd, /Resume manual Apply after interruption/);
    assert.match(liveMd, /Polling is not commit/);
    assert.match(liveMd, /Source persistence requires both steps: apply the event's source edits, then reply with `--reply EVENT_ID done --data/);
    assert.match(liveMd, /do not run `live-commit-manual-edits\.mjs` for that event/);
    assert.match(liveMd, /Applying 3 staged copy edits across src\/App\.jsx/);
    assert.match(liveMd, /Do not put these progress sentences inside `--data`/);
    assert.match(liveMd, /Never leave source changes behind for entries that are failed, omitted, or absent from `appliedEntryIds`/);
    assert.match(liveMd, /server treats that as an invalid partial-entry write and rolls the whole batch back/);
    assert.match(liveMd, /Do not ask the user whether to apply, which edits to apply, or what they want done with the staged edits/);
    assert.match(liveMd, /The browser Apply click is the instruction and confirmation/);
    assert.match(liveMd, /Manual copy edits are first-class live-mode work, not test noise/);
    assert.match(liveMd, /never call it a test edit, never clean it up, never discard it/);
    assert.match(liveMd, /never redirect the user back to the visual picker/);
    assert.match(liveMd, /If Discard runs while a chat-routed Apply is in flight/);
    assert.match(liveMd, /A late reply for the old event id is stale; do not retry it/);
    assert.match(liveMd, /Response: `\{ discarded, entries, canceledApplyEvents, totalCount, perPage \}`/);
    assert.match(liveMd, /multiple small `manual_edit_apply` chunks/);
    assert.match(liveMd, /current event's `batch` as the complete current work unit/);
    assert.match(liveMd, /Do not infer that missing later entries failed/);
    assert.match(liveMd, /Applied chunk 2\/7; polling for the next Apply chunk/);
    assert.match(liveMd, /For Astro `\.astro` inject targets, `live-inject\.mjs` writes `<script is:inline src="http:\/\/localhost:PORT\/live\.js"><\/script>` automatically/);
    assert.match(liveMd, /Do not hand-copy a bare `<script src="\.\.\.\/live\.js">` into Astro source/);
    assert.match(liveMd, /Missing `sourceHint` is not a failure/);
    assert.match(liveMd, /dynamic rendered UI often has none/);
    assert.match(liveMd, /objectKeyMatches/);
    assert.match(liveMd, /Do not fail solely because `sourceHint` is missing/);
    assert.match(liveMd, /do not coerce the source model field/);
    assert.match(liveMd, /fail that entry instead of demo-applying a string into the model/);
  });

  it('keeps live preview CSS guidance capability-mode driven', () => {
    const liveMd = readFileSync(join(ROOT, 'skill/reference/live.md'), 'utf-8');

    assert.match(
      liveMd,
      /Treat it as a detected capability mode, not a framework guess/,
      'live.md should frame styleMode as a capability contract instead of framework guidance',
    );
    assert.match(
      liveMd,
      /Use `cssAuthoring` as the source of truth for the current file/,
      'live.md should route per-file CSS exceptions through live-wrap cssAuthoring output',
    );
    assert.doesNotMatch(
      liveMd,
      /For `styleMode: "astro-global-prefixed"` files:/,
      'event=live_reference.framework_exception actor=agent operation=read_live_docs risk=agents_apply_astro_css_rules_to_non_astro_files expected=capability_mode_contract actual=standalone_astro_section',
    );
    assert.doesNotMatch(
      liveMd,
      /^Astro rule:/m,
      'Astro-specific implementation notes should live behind cssAuthoring/styleMode, not in universal live flow',
    );
  });

  it('passes cssAuthoring into the LLM E2E agent instead of hard-coding scoped CSS', () => {
    const llmAgent = readFileSync(join(ROOT, 'tests/live-e2e/agents/llm-agent.mjs'), 'utf-8');

    assert.match(
      llmAgent,
      /wrapInfo\.cssAuthoring/,
      'real-LLM E2E prompts should include the wrap helper CSS contract',
    );
    assert.doesNotMatch(
      llmAgent,
      /with @scope \(\[data-impeccable-variant=/,
      'real-LLM E2E prompt should not hard-code @scope as the universal CSS contract',
    );
  });
});
