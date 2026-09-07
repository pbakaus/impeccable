import assert from 'node:assert/strict';
import { sourceHash } from './source-hash.mjs';

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
