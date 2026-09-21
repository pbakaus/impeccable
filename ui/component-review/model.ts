export type Box = { x: number; y: number; w: number; h: number };
export type Component = {
  id: string; revision: string; name: string; medium: string; note: string; box: Box;
  reviewGroup?: string;
  material?: { format: string; width: number; height: number; alpha: 'transparent' | 'opaque' | 'unknown' };
  context?: { kind?: 'image' | 'page'; sourceKind?: 'page'; url: string; layering: string };
  thumbnail?: { url: string; box?: Box };
  preview: { kind: 'image' | 'page'; sourceKind?: 'page'; isolation?: { method: 'dom-component-v1'; selector: string; excludedComponents: string[] }; url: string; position?: string };
};
export type ReviewPacket = {
  id: string; revision: string; title: string; round: number; stage?: 'components' | 'hero';
  comp: { url: string; width: number; height: number; background?: string }; components: Component[];
};
export type Decision = { revision: string; action: 'approve' | 'revise'; feedback: string; split: boolean };
export type Missing = { id: string; name: string; box: Box; feedback: string };
export type Draft = { packetRevision: string; decisions: Record<string, Decision>; missing: Missing[]; inventoryConfirmed: boolean };
export type ReviewHistory = {
  packet: ReviewPacket; draft: Draft; submitted: boolean;
  changes: Record<string, { kind: 'added' | 'changed' | 'unchanged'; files: string[]; reasons: string[]; carried?: boolean }>;
  feedback?: Record<string, { round: number; decision: Decision }>;
  removed: { id: string; name: string }[];
};
export function repairStatus(id: string, history?: ReviewHistory | null) {
  const change = history?.changes[id];
  const outstanding = history?.feedback?.[id];
  const prior = outstanding?.decision ?? (history?.submitted ? history.draft.decisions[id] : undefined);
  const carried = change?.kind === 'unchanged' && (change.carried ?? (history?.submitted && prior?.action === 'approve')) === true;
  return {
    change, prior, feedbackRound: outstanding?.round ?? history?.packet.round,
    carried,
    label: change?.kind === 'added' ? 'New component'
      : change?.kind === 'changed' ? 'Review again'
      : carried ? 'Approval kept'
      : prior?.action === 'revise' ? 'Changes still requested' : 'Awaiting review',
  };
}
export function componentState(component: Component, draft: Draft, history?: ReviewHistory | null) {
  const saved = draft.decisions[component.id];
  const decision = saved?.revision === component.revision ? saved : undefined;
  const repair = repairStatus(component.id, history);
  if (decision?.action === 'approve') return { kind: 'approved' as const, label: repair.carried ? 'Approval kept' : 'Approved', priority: 3 };
  if (decision?.action === 'revise') return { kind: 'feedback' as const, label: 'Feedback ready', priority: 2 };
  return { kind: 'pending' as const, label: repair.change?.kind === 'changed' ? 'Review again' : repair.change?.kind === 'added' ? 'New · review needed' : 'Not reviewed', priority: repair.change?.kind === 'changed' || repair.change?.kind === 'added' ? 0 : 1 };
}
export function newDraft(packet: ReviewPacket): Draft {
  return { packetRevision: packet.revision, decisions: {}, missing: [], inventoryConfirmed: false };
}
export function validBox(b: Box) {
  return Object.values(b).every(Number.isFinite) && b.x >= 0 && b.y >= 0 && b.w > 0 && b.h > 0 && b.x + b.w <= 1.00001 && b.y + b.h <= 1.00001;
}
export function summarize(packet: ReviewPacket, draft: Draft) {
  const decisions = packet.components.map(c => draft.decisions[c.id]?.revision === c.revision ? draft.decisions[c.id] : undefined);
  const approved = decisions.filter(d => d?.action === 'approve').length;
  const revisions = decisions.filter(d => d?.action === 'revise').length;
  const pending = decisions.length - approved - revisions;
  const hasFeedback = revisions > 0 || draft.missing.length > 0;
  return { approved, revisions, pending, hasFeedback,
    canSubmit: draft.packetRevision === packet.revision && draft.missing.every(m => m.name.trim() && validBox(m.box)) && (hasFeedback || (!pending && draft.inventoryConfirmed)) };
}
export function approveRemaining(packet: ReviewPacket, draft: Draft): Draft {
  const decisions = { ...draft.decisions };
  for (const c of packet.components) {
    if (!decisions[c.id] || decisions[c.id].revision !== c.revision) decisions[c.id] = { revision: c.revision, action: 'approve', feedback: '', split: false };
  }
  return { ...draft, decisions };
}
/** UI drafts are not authority. A trusted adapter must verify versions and actor before persisting. */
export function submission(packet: ReviewPacket, draft: Draft) {
  if (!summarize(packet, draft).canSubmit) throw new Error('Review is incomplete or stale');
  return { schemaVersion: 1, requestId: packet.id, ...structuredClone(draft) };
}

/** A code capture is an image for display, but is still a code implementation. */
export function componentPresentation(component: Component) {
  const code = component.preview.kind === 'page' || component.preview.sourceKind === 'page';
  const captured = component.preview.sourceKind === 'page';
  return {
    code, captured,
    label: code ? (component.medium.match(/html|css|svg/i) ? component.medium : 'HTML / CSS / SVG') : 'Raster',
    caption: code ? (captured ? component.preview.isolation ? 'Component only' : 'Region capture' : 'Live component') : 'Produced asset',
    fileLabel: captured ? 'Open captured preview' : 'Open source image',
  };
}

/** Continue in component order, wrapping once and skipping current decisions.
 * Carried approvals arrive as versioned decisions; stale ones remain pending. */
export function nextUnreviewed(packet: ReviewPacket, draft: Draft, after?: string): string | undefined {
  const start = packet.components.findIndex(c => c.id === after);
  for (let step = 1; step <= packet.components.length; step++) {
    const component = packet.components[(start + step) % packet.components.length];
    if (componentState(component, draft).kind === 'pending') return component.id;
  }
}

export type InventoryFilter = 'pending' | 'reviewed' | 'all';
/** Repair requests are completed review decisions, not work left for the reviewer. */
export function inReviewQueue(component: Component, draft: Draft, filter: InventoryFilter) {
  return filter === 'all' || (componentState(component, draft).kind === 'pending') === (filter === 'pending');
}

/** Grouping is authored explicitly, never guessed from names or visual similarity.
 * Decisions remain per component; existing decisions and unsaved edits are excluded. */
export function reviewPeers(packet: ReviewPacket, component: Component): Component[] {
  if (!component.reviewGroup || !componentPresentation(component).code) return [component];
  return packet.components.filter(c => c.reviewGroup === component.reviewGroup && componentPresentation(c).code);
}
export function decisionTargets(packet: ReviewPacket, draft: Draft, selected: Component, grouped: boolean, editing: string[] = []) {
  const peers = grouped ? reviewPeers(packet, selected) : [selected];
  if (peers.length === 1) return [selected];
  return peers.filter(c => componentState(c, draft).kind === 'pending' &&
    (c.id === selected.id || !editing.includes(c.id)));
}


/** One visible review unit per explicitly authored code pattern. Receipts stay
 * per instance, including revision checks and individual exceptions. */
export function reviewUnits(packet: ReviewPacket, draft: Draft, history?: ReviewHistory | null) {
  const seen = new Set<string>();
  return packet.components.flatMap(component => {
    if (seen.has(component.id)) return [];
    const members = reviewPeers(packet, component);
    members.forEach(c => seen.add(c.id));
    const pending = members.filter(c => componentState(c,draft,history).kind === 'pending');
    const feedback = members.filter(c => componentState(c,draft,history).kind === 'feedback');
    const representative = pending[0] ?? feedback[0] ?? component;
    const kind = pending.length ? 'pending' as const : feedback.length ? 'feedback' as const : 'approved' as const;
    return [{id:component.id, members, representative, pending:pending.length, kind,
      label:members.length > 1 ? component.reviewGroup!.replace(/[-_]+/g,' ').replace(/^./,c=>c.toUpperCase()) : component.name,
      box: {x:Math.min(...members.map(c=>c.box.x)),y:Math.min(...members.map(c=>c.box.y)),
        w:Math.max(...members.map(c=>c.box.x+c.box.w))-Math.min(...members.map(c=>c.box.x)),
        h:Math.max(...members.map(c=>c.box.y+c.box.h))-Math.min(...members.map(c=>c.box.y))},
      stateLabel:pending.length ? (members.length>1 ? `${pending.length} to review` : componentState(representative,draft,history).label)
        : feedback.length ? (members.length>1 ? `${feedback.length} ${feedback.length===1?'needs':'need'} work` : 'Feedback ready') : 'Approved'}];
  });
}

/** Nearby map geometry is context, not proof of capture exclusions. Only the
 * capture's explicit exclusion list can identify deliberately hidden layers. */
export function reviewScope(packet: ReviewPacket, component: Component) {
  const excluded = new Set(component.preview.isolation?.excludedComponents ?? []);
  const b = component.box;
  const related = packet.components.filter(other => {
    if (other.id === component.id) return false;
    if (excluded.has(other.id)) return true;
    const o = other.box;
    const overlapWidth = Math.min(b.x+b.w,o.x+o.w)-Math.max(b.x,o.x);
    const overlapHeight = Math.min(b.y+b.h,o.y+o.h)-Math.max(b.y,o.y);
    // Smaller mapped pieces may cross a photograph's edge (headings and route
    // lines often do). Include their visible intersection, ignoring subpixel
    // boundary noise. This describes scope only; no pixels or decisions change.
    return o.w*o.h < b.w*b.h && overlapWidth*packet.comp.width > 1 && overlapHeight*packet.comp.height > 1;
  });
  return {description:component.note.trim(), related, excluded:related.filter(c=>excluded.has(c.id))};
}
