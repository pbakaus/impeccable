/** Plan and asset review (packet schemaVersion 3). Pure logic; the view lives in plan-review.ts.
 * Contract: docs/PLAN-REVIEW.md. */
import { validBox, type Box, type Missing } from './model';

export type AssetKind = 'plate' | 'image' | 'texture';
export type Flag = { id: string; message: string };
export type PlanItem = {
  id: string; revision: string; name: string; kind: string; role: 'asset' | 'plan';
  box: Box; note: string; medium?: string;
  preview: { kind: 'image' | 'comp-crop' | 'page'; url?: string };
  flags?: Flag[]; codeDrawn?: boolean;
  material?: { format: string; width: number; height: number; alpha: 'transparent' | 'opaque' | 'unknown' };
};
export type CodeRegion = { id: string; name: string; kind: string; box: Box; note?: string; container?: boolean };
export type PlanPacket = {
  schemaVersion: 3; stage: 'components'; id: string; revision: string; title: string; round: number;
  comp: { url: string; width: number; height: number; background?: string };
  components: PlanItem[]; codeRegions?: CodeRegion[]; specSha256?: string;
};
export type PlanDecision = { revision: string; action: 'approve' | 'revise' | 'reclassify'; feedback: string; split: boolean; kind?: AssetKind };
export type Reclassify = { id: string; kind: AssetKind; feedback: string };
export type PlanDraft = { packetRevision: string; decisions: Record<string, PlanDecision>; missing: Missing[]; inventoryConfirmed: boolean; reclassify?: Reclassify[] };
export type PlanHistory = {
  packet: PlanPacket; submitted: boolean;
  changes: Record<string, { kind: 'added' | 'changed' | 'unchanged'; files: string[]; reasons: string[]; carried?: boolean }>;
  feedback?: Record<string, { round: number; decision: { action: string; feedback?: string; kind?: string; split?: boolean } }>;
};
export type ItemState = 'pending' | 'approved' | 'revise' | 'reclassify';

export const ASSET_KINDS: { kind: AssetKind; label: string; hint: string }[] = [
  { kind: 'plate', label: 'Illustration / plate', hint: 'Painted or drawn artwork' },
  { kind: 'image', label: 'Photo / image', hint: 'A photograph' },
  { kind: 'texture', label: 'Texture', hint: 'A surface or material' },
];
export const assetKindLabel = (kind: AssetKind) => ASSET_KINDS.find(k => k.kind === kind)!.label;

export function isPlanPacket(packet: unknown): packet is PlanPacket {
  const p = packet as Partial<PlanPacket> | null;
  return !!p && p.schemaVersion === 3 && p.stage === 'components';
}

/** Plan items that need attention: the comp looks painted, or the plan draws artwork in code. */
export function isFlagged(item: PlanItem) {
  return item.role === 'plan' && (!!item.flags?.length || !!item.codeDrawn);
}

/** Flagged plan items first, then assets, then remaining plan items. Stable within groups. */
export function planQueue(packet: PlanPacket): PlanItem[] {
  const rank = (c: PlanItem) => isFlagged(c) ? 0 : c.role === 'asset' ? 1 : 2;
  return packet.components.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map(x => x.c);
}

/** Code regions without a component entry; containers last so they never crowd the list. */
export function extraRegions(packet: PlanPacket): CodeRegion[] {
  const ids = new Set(packet.components.map(c => c.id));
  return (packet.codeRegions ?? []).filter(r => !ids.has(r.id));
}

export function currentDecision(item: PlanItem, draft: PlanDraft): PlanDecision | undefined {
  const d = draft.decisions[item.id];
  return d?.revision === item.revision ? d : undefined;
}

export function itemState(item: PlanItem, draft: PlanDraft): ItemState {
  const d = currentDecision(item, draft);
  return d ? d.action === 'approve' ? 'approved' : d.action : 'pending';
}

export function regionReclassify(draft: PlanDraft, id: string) {
  return draft.reclassify?.find(r => r.id === id);
}

/** Surface words suggest a texture; photographic words an image; otherwise a plate. */
export function defaultAssetKind(item: { note?: string; name?: string; flags?: Flag[] }): AssetKind {
  const text = [item.name, item.note, ...(item.flags ?? []).map(f => f.message)].join(' ');
  if (/\b(textures?|surfaces?|grain|grainy|brushed|metal(lic)?|steel|brass|copper|paper|linen|canvas|fabric|cloth|wood(en)?|stone|marble|concrete|plaster|leather|noise|pattern(ed)?|weave|patina)\b/i.test(text)) return 'texture';
  if (/\b(photo|photos|photograph|photographs|photographic|photography)\b/i.test(text) && !/\bphotographic shading\b/i.test(text)) return 'image';
  return 'plate';
}

/** The plan statement shown for a code-planned item. */
export function planStatement(item: { kind: string }) {
  return `Drawn in code (${item.kind})`;
}

/** comp-spec writes each flag message as a reviewer-facing observation; show it as written. */
export function flagMessage(flag: Flag) {
  return flag.message;
}

export function planSummary(packet: PlanPacket, draft: PlanDraft) {
  const states = packet.components.map(c => itemState(c, draft));
  const approved = states.filter(s => s === 'approved').length;
  const revise = states.filter(s => s === 'revise').length;
  const extraIds = new Set(extraRegions(packet).map(r => r.id));
  const regionReclassifications = (draft.reclassify ?? []).filter(r => extraIds.has(r.id)).length;
  const reclassify = states.filter(s => s === 'reclassify').length + regionReclassifications;
  const pending = states.filter(s => s === 'pending').length;
  const missing = draft.missing.length;
  const hasChanges = revise + reclassify + missing > 0;
  const current = draft.packetRevision === packet.revision;
  const missingValid = draft.missing.every(m => m.name.trim() && validBox(m.box));
  const canApprove = current && !hasChanges && pending === 0;
  return {
    total: states.length, approved, revise, reclassify, pending, missing, hasChanges, canApprove,
    mode: hasChanges ? 'changes' as const : 'approve' as const,
    canSubmit: current && missingValid && (hasChanges || canApprove),
  };
}

/** Pure decision update. Returns the next draft; callers keep the old one for undo. */
export function decide(draft: PlanDraft, item: PlanItem, action: PlanDecision['action'], options: { feedback?: string; kind?: AssetKind; split?: boolean } = {}): PlanDraft {
  // Split asks for a baked composite to come back as layers; only an asset's revise can carry it.
  if (options.split && !(action === 'revise' && item.role === 'asset')) throw new Error('Only a generated asset can be split into layers');
  // A plan item's revise is a region-map change in the reviewer's words, so it needs them.
  if (action === 'revise' && item.role !== 'asset' && !(options.feedback ?? '').trim()) throw new Error('Revising a plan item needs feedback');
  if (action === 'reclassify' && item.role !== 'plan') throw new Error('Only planned code can become an image');
  const decision: PlanDecision = { revision: item.revision, action, feedback: action === 'approve' ? '' : (options.feedback ?? '').trim(), split: !!options.split };
  if (action === 'reclassify') decision.kind = options.kind ?? defaultAssetKind(item);
  return { ...draft, inventoryConfirmed: false, decisions: { ...draft.decisions, [item.id]: decision } };
}
export function clearDecision(draft: PlanDraft, id: string): PlanDraft {
  const decisions = { ...draft.decisions };
  delete decisions[id];
  return { ...draft, inventoryConfirmed: false, decisions };
}
export function setRegionReclassify(draft: PlanDraft, id: string, value: { kind: AssetKind; feedback?: string } | null): PlanDraft {
  const rest = (draft.reclassify ?? []).filter(r => r.id !== id);
  return { ...draft, inventoryConfirmed: false, reclassify: value ? [...rest, { id, kind: value.kind, feedback: (value.feedback ?? '').trim() }] : rest };
}

/** Next undecided queue item after `after`, wrapping once. */
export function nextPending(packet: PlanPacket, draft: PlanDraft, after?: string): string | undefined {
  const queue = planQueue(packet);
  const start = queue.findIndex(c => c.id === after);
  for (let step = 1; step <= queue.length; step++) {
    const item = queue[(start + step) % queue.length];
    if (itemState(item, draft) === 'pending') return item.id;
  }
}

/** Submission body. Approval (nothing changed, nothing missing) confirms the inventory;
 * a changes submission never does. Region reclassifications travel separately. */
export function planSubmission(packet: PlanPacket, draft: PlanDraft) {
  const summary = planSummary(packet, draft);
  if (!summary.canSubmit) throw new Error('Review is incomplete or stale');
  const decisions: Record<string, PlanDecision> = {};
  for (const c of packet.components) {
    const d = currentDecision(c, draft);
    if (d) decisions[c.id] = structuredClone(d);
  }
  const extraIds = new Set(extraRegions(packet).map(r => r.id));
  const reclassify = (draft.reclassify ?? []).filter(r => extraIds.has(r.id)).map(r => ({ ...r }));
  return {
    schemaVersion: 1 as const, requestId: packet.id, packetRevision: draft.packetRevision,
    decisions, missing: structuredClone(draft.missing), inventoryConfirmed: summary.mode === 'approve',
    ...(reclassify.length ? { reclassify } : {}),
  };
}

export function newPlanDraft(packet: PlanPacket): PlanDraft {
  return { packetRevision: packet.revision, decisions: {}, missing: [], inventoryConfirmed: false, reclassify: [] };
}

/** Pixels around a box, as [r,g,b] samples, from RGBA image data of the whole comp. */
export function ringSamples(data: ArrayLike<number>, width: number, height: number, box: Box, margin = 0.02): [number, number, number][] {
  const x0 = Math.max(0, Math.floor((box.x - margin) * width)), x1 = Math.min(width - 1, Math.ceil((box.x + box.w + margin) * width));
  const y0 = Math.max(0, Math.floor((box.y - margin) * height)), y1 = Math.min(height - 1, Math.ceil((box.y + box.h + margin) * height));
  const ix0 = Math.floor(box.x * width), ix1 = Math.ceil((box.x + box.w) * width), iy0 = Math.floor(box.y * height), iy1 = Math.ceil((box.y + box.h) * height);
  const out: [number, number, number][] = [];
  const step = Math.max(1, Math.round(Math.max(x1 - x0, y1 - y0) / 80));
  for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) {
    if (x >= ix0 && x < ix1 && y >= iy0 && y < iy1) continue;
    const i = (y * width + x) * 4;
    if (data[i + 3] < 200) continue;
    out.push([data[i], data[i + 1], data[i + 2]]);
  }
  return out;
}
/** Per-channel median as a hex colour; undefined when nothing surrounds the box. */
export function medianColor(samples: [number, number, number][]): string | undefined {
  if (!samples.length) return undefined;
  const channel = (n: number) => { const v = samples.map(s => s[n]).sort((a, b) => a - b); return v[v.length >> 1]; };
  return '#' + [0, 1, 2].map(n => channel(n).toString(16).padStart(2, '0')).join('');
}

/** The comp crop for a plan region: the box plus a modest margin, scaled so the region fills the
 * pane width (context lives on the comp map, not in this crop). A region so thin that it would
 * render under `minHeight` px is scaled up to that height and shown as a centred segment. */
export function planView(box: Box, compWidth: number, compHeight: number, width: number, height: number, maxScale = 4, minHeight = 24) {
  const bw = box.w * compWidth, bh = box.h * compHeight;
  const margin = Math.min(24, Math.max(8, 0.04 * Math.max(bw, bh)));
  let vw = Math.min(compWidth, bw + margin * 2), vh = Math.min(compHeight, bh + margin * 2);
  let scale = Math.min(maxScale, width / vw, height / vh);
  if (bh * scale < minHeight && bh > 0) {
    scale = Math.min(maxScale, minHeight / bh, height / vh);
    vw = Math.min(vw, width / scale);
  }
  const cx = (box.x + box.w / 2) * compWidth, cy = (box.y + box.h / 2) * compHeight;
  const x = Math.max(0, Math.min(compWidth - vw, cx - vw / 2)), y = Math.max(0, Math.min(compHeight - vh, cy - vh / 2));
  return { scale, width: vw * scale, height: vh * scale, view: { x: x / compWidth, y: y / compHeight, w: vw / compWidth, h: vh / compHeight } };
}

/** Largest same-scale layout for two crops of aspect `ratio` (w/h): side by side or stacked. */
export function pairLayout(ratio: number, width: number, height: number, gap: number, caption: number, maxScale = Infinity, natural?: { w: number; h: number }) {
  const fit = (w: number, h: number) => {
    let cw = Math.max(0, w), ch = cw / ratio;
    if (ch > h) { ch = Math.max(0, h); cw = ch * ratio; }
    if (natural && cw > natural.w * maxScale) { cw = natural.w * maxScale; ch = cw / ratio; }
    return { w: cw, h: ch };
  };
  const side = fit((width - gap) / 2, height - caption);
  const stacked = fit(width, (height - gap) / 2 - caption);
  return side.w * side.h >= stacked.w * stacked.h ? { direction: 'row' as const, ...side } : { direction: 'column' as const, ...stacked };
}

// ---------------------------------------------------------------------------
// Stage flow (intro, one item at a time, summary). Pure helpers for the view.

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const word = (n: number) => WORDS[n] ?? String(n);
const Cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** What the reviewer is about to do, in one sentence (the intro screen). */
export function introLine(packet: PlanPacket, draft: PlanDraft, history?: PlanHistory | null) {
  const pending = packet.components.filter(c => itemState(c, draft) === 'pending').length;
  if (history && packet.round > 1) {
    const worked = packet.components.filter(c => ['changed', 'added'].includes(history.changes[c.id]?.kind ?? '') || history.feedback?.[c.id]).length;
    const kept = packet.components.filter(c => itemState(c, draft) === 'approved').length;
    return `The agent worked on your notes for ${word(worked)} ${worked === 1 ? 'item' : 'items'}. ${Cap(word(kept))} ${kept === 1 ? 'approval is' : 'approvals are'} kept.`;
  }
  const minutes = Math.max(1, Math.round(pending * 15 / 60));
  return `${Cap(word(pending))} ${pending === 1 ? 'thing' : 'things'} to check before any page code is written. About ${word(minutes)} ${minutes === 1 ? 'minute' : 'minutes'}.`;
}

/** The last round's request for this item, and what it looked like then. */
/** Guidance prefilled when the reviewer asks for a composite to be split. */
export const SPLIT_GUIDANCE = 'Frame, view and moving parts as separate pieces, e.g. the shutters.';
/** Flags an asset carries (a baked composite, painted pixels): shown as a note on the stage. */
export function assetFlags(item: PlanItem) { return item.role === 'asset' ? item.flags ?? [] : []; }
export const isBakedComposite = (item: PlanItem) => assetFlags(item).some(f => f.id === 'baked-composite');
export const isSplit = (d?: PlanDecision) => d?.action === 'revise' && d.split === true;

export function priorRound(id: string, history?: PlanHistory | null) {
  if (!history) return null;
  // A split region comes back as new items (window-frame, window-view): link them to the
  // region they came from by id prefix, so the reviewer sees their own note again.
  const splitFrom = history.feedback?.[id] ? undefined : Object.entries(history.feedback ?? {})
    .filter(([from, f]) => f.decision.action === 'revise' && f.decision.split && id.startsWith(`${from}-`))
    .sort((a, b) => b[0].length - a[0].length)[0];
  if (splitFrom) {
    const [from, f] = splitFrom;
    return { round: f.round, action: 'split', words: (f.decision.feedback ?? '').trim(), splitFrom: history.packet.components.find(c => c.id === from)?.name ?? from, beforeUrl: undefined, wasCode: false, wasKind: undefined, wasNote: '' };
  }
  const asked = history.feedback?.[id];
  const before = history.packet.components.find(c => c.id === id);
  const beforeRegion = history.packet.codeRegions?.find(r => r.id === id);
  const change = history.changes[id]?.kind;
  if (!asked && change !== 'changed') return null;
  return {
    round: asked?.round ?? history.packet.round,
    action: asked?.decision.action,
    words: (asked?.decision.feedback ?? '').trim(),
    beforeUrl: before?.role === 'asset' ? before.preview.url : undefined,
    // A region that was planned in code last round and is now an asset.
    wasCode: (before?.role === 'plan' || (!before && !!beforeRegion)),
    wasKind: before?.kind ?? beforeRegion?.kind,
    wasNote: before?.note ?? beforeRegion?.note ?? '',
    splitFrom: undefined as string | undefined,
  };
}

/** Equal-height figures for aspect ratios (w/h): in a row, or stacked at equal width when
 * that shows more. Each figure reserves `caption` px above it; `natural` caps the scale. */
export function figureLayout(ratios: number[], width: number, height: number, gap: number, caption: number, maxScale = 4, natural?: { w: number; h: number }) {
  const n = ratios.length;
  let rowH = Math.max(0, Math.min(height - caption, (width - gap * (n - 1)) / ratios.reduce((a, r) => a + r, 0)));
  let colW = Math.max(0, Math.min(width, (height - n * caption - gap * (n - 1)) / ratios.reduce((a, r) => a + 1 / r, 0)));
  if (natural) { rowH = Math.min(rowH, natural.h * maxScale); colW = Math.min(colW, natural.w * maxScale); }
  const rowArea = ratios.reduce((a, r) => a + r * rowH * rowH, 0);
  const colArea = ratios.reduce((a, r) => a + colW * colW / r, 0);
  return rowArea >= colArea
    ? { direction: 'row' as const, sizes: ratios.map(r => ({ w: r * rowH, h: rowH })) }
    : { direction: 'column' as const, sizes: ratios.map(r => ({ w: colW, h: colW / r })) };
}

/** Loupe: the translate that centres point (fx, fy) of a w x h image, scaled by zoom, in a lens of radius r. */
export function loupeOffset(fx: number, fy: number, w: number, h: number, r: number, zoom: number) {
  return { x: r - fx * w * zoom, y: r - fy * h * zoom };
}

/** Progress row: one light per item. */
export function progressLights(packet: PlanPacket, draft: PlanDraft, current?: string) {
  return planQueue(packet).map(c => ({ id: c.id, name: c.name, state: itemState(c, draft), current: c.id === current }));
}

/** The submit line on the summary: what will be sent, in counts. */
export function sendLabel(packet: PlanPacket, draft: PlanDraft) {
  const s = planSummary(packet, draft);
  if (s.mode === 'approve') return 'Approve plan and assets';
  const splits = packet.components.filter(c => isSplit(currentDecision(c, draft))).length;
  const notes = s.revise - splits;
  const parts = [notes ? `${notes} ${notes === 1 ? 'note' : 'notes'}` : '', splits ? `${splits} to split` : '', s.reclassify ? `${s.reclassify} to become ${s.reclassify === 1 ? 'an image' : 'images'}` : '', s.missing ? `${s.missing} missing` : ''].filter(Boolean);
  return `Send notes (${parts.join(', ')})`;
}
