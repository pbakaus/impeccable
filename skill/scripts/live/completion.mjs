// A preview whose variants live outside the user's source: component modules or
// an isolated artifact. These keep the real file untouched until Accept, so a
// failed accept leaves nothing in source for the agent to hand-edit and must be
// reported as a failure rather than reference/live.md's manual-cleanup handoff.
// Previously only `svelte-component` was special-cased here, so the same failure
// on a Vue or isolated-artifact preview was acknowledged as a success.
const PREVIEW_MODES_WITHOUT_SOURCE_MARKERS = new Set([
  'svelte-component',
  'vue-component',
  'source-artifact',
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
