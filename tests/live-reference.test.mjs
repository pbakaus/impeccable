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
