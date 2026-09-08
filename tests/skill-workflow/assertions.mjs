import assert from 'node:assert/strict';
import { sourceHash } from './source-hash.mjs';
import { missingReferences } from '../skill-behavior/assertions.mjs';

// For a resumed, already-reviewed ordinary extension only. New worlds and
// redesigns still owe real documentation writes; this is not an escape hatch.
export function assertNoChangeDocumentation(result, { target, evidence }) {
  assertCompleted(result);
  const { trace, text } = result;
  assert.deepEqual(missingReferences(trace, ['reference/document.md', target, 'DESIGN.md']), [],
    'documentation must consult its contract and inspect the actual source and recorded system');
  assert.deepEqual(trace.toolCalls.flatMap((call) => call.mutatedPaths || []), [],
    'the resumed no-change check must not mutate project files');
  assert.match(text, /no (?:system |visual.system |documentation )?changes|unchanged|no rewrite/i,
    'documentation must explicitly report a no-change outcome');
  for (const filename of [target, 'DESIGN.md']) {
    assert.ok(text.includes(filename), `documentation must identify the checked ${filename}`);
  }
  for (const fact of evidence) {
    assert.match(text, fact, 'no-change documentation must report evidence from the fixture, not an unsupported completion claim');
  }
}

export function assertCompleted(result) {
  assert.equal(result.outcome, 'complete', `workflow did not finish: ${result.outcome} after ${result.steps} steps`);
}

export function assertFreshCaptures(trace, workspace, target) {
  const calls = trace.toolCalls;
  const lastEdit = calls.findLastIndex((call) => (call.mutatedPaths || []).includes(target));
  const hash = sourceHash(workspace);
  for (const viewport of ['desktop', 'mobile']) {
    assert.ok(calls.some((call, index) => index > lastEdit && call.capture?.target === target
      && call.capture.viewport === viewport && call.capture.sourceHash === hash),
    `missing ${viewport} screenshot of the final ${target}; pre-edit captures do not count`);
  }
}
