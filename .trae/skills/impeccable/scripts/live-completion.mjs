export function completionTypeForAcceptResult(eventType, acceptResult) {
  if (eventType === 'discard') return acceptResult?.handled === true ? 'discarded' : 'error';
  if (acceptResult?.handled === true) return 'complete';
  if (acceptResult?.mode === 'fallback') return 'agent_done';
  return 'error';
}
