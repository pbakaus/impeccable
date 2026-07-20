export function eventPriority(event = {}) {
  if (event.type === 'accept' || event.type === 'discard' || event.type === 'exit') return 0;
  if (event.type === 'manual_edit_apply' || event.type === 'steer' || event.type === 'carbonize_cleanup') return 1;
  if (event.type === 'generate') return 2;
  return 3;
}

export function selectAvailablePendingEvent(entries, { now = Date.now(), types = null } = {}) {
  const allowed = types instanceof Set ? types : (Array.isArray(types) ? new Set(types) : null);
  return entries
    .filter((entry) => !(entry.leaseUntil && entry.leaseUntil > now))
    .filter((entry) => !allowed || allowed.has(entry.event?.type))
    .sort((a, b) => eventPriority(a.event) - eventPriority(b.event) || a.seq - b.seq)[0] || null;
}
