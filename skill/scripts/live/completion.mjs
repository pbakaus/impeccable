// A preview whose variants live in component modules rather than in the user's
// source. These leave no markers in the real file, so a failed accept gives the
// agent nothing to hand-edit and must be reported as a failure rather than
// reference/live.md's manual-cleanup handoff. Previously only `svelte-component`
// was special-cased, so the same failure on a Vue preview read as success.
const PREVIEW_MODES_WITHOUT_SOURCE_MARKERS = new Set([
  'svelte-component',
  'vue-component',
]);

export function completionTypeForAcceptResult(eventType, acceptResult) {
  if (eventType === 'discard') return acceptResult?.handled === true ? 'discarded' : 'error';
  if (acceptResult?.handled === true && acceptResult?.carbonize === true) return 'agent_done';
  if (acceptResult?.handled === true) return 'complete';
  if (acceptResult?.mode === 'error') return 'error';
  if (eventType === 'accept' && PREVIEW_MODES_WITHOUT_SOURCE_MARKERS.has(acceptResult?.previewMode)) return 'error';
  return 'agent_done';
}

export function completionAckForAcceptResult(eventId, completionType, acceptResult) {
  const ack = { ok: true, type: completionType };
  if (acceptResult?.handled === true && acceptResult?.carbonize === true) {
    ack.final = false;
    ack.requiresComplete = true;
    ack.nextCommand = `live-complete.mjs --id ${eventId}`;
    ack.message = 'Carbonize cleanup must be verified, then the session must be completed explicitly before polling again.';
  }
  return ack;
}
