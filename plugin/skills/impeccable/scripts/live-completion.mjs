export function completionTypeForAcceptResult(eventType, acceptResult) {
  if (eventType === 'discard') return acceptResult?.handled === true ? 'discarded' : 'error';
  if (acceptResult?.handled === true) return 'complete';
  if (acceptResult?.mode === 'error') return 'error';
  return 'agent_done';
}
