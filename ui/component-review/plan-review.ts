/** Plan and asset review (packet schemaVersion 3, stage components). Contract: docs/PLAN-REVIEW.md.
 * One decision per item, large comparisons, region outlines on the comp. The first-viewport
 * (hero) stage keeps its own view in review.ts. */
import {
  ASSET_KINDS, assetKindLabel, clearDecision, currentDecision, decide, defaultAssetKind, extraRegions,
  flagMessage, isFlagged, itemState, medianColor, newPlanDraft, nextPending, pairLayout, planQueue, planView, planStatement,
  planSubmission, planSummary, regionReclassify, ringSamples, setRegionReclassify,
  type AssetKind, type CodeRegion, type PlanDraft, type PlanHistory, type PlanItem, type PlanPacket,
} from './plan-model';
import type { Box } from './model';
import { planStyles } from './plan-styles';
import { ksArrow } from './kit';
import { initInstrumentStrips } from './instrument-strip';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const pct = (n: number) => `${n * 100}%`;
// Only trusted adapter URLs may enter images. Never accept javascript: or executable data URLs.
const url = (s: string) => {
  const parsed = new URL(s, location.href);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported preview URL');
  return esc(parsed.href);
};
const boxStyle = (b: Box) => `left:${pct(b.x)};top:${pct(b.y)};width:${pct(b.w)};height:${pct(b.h)}`;
const svg = (d: string) => `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">${d}</svg>`;
const ICON = {
  check: svg('<path d="m3 8.5 3 3 7-7"/>'),
  pencil: svg('<path d="m3 11 1 2 2-1 7-7-3-3-7 7v2Z"/>'),
  image: svg('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="m2.5 11.5 3.5-3.5 3 3 2-2 2.5 2.5"/>'),
  mark: svg('<path d="M6 2.5H2.5V6M10 2.5h3.5V6M2.5 10v3.5H6M13.5 10v3.5H10M8 5.5v5M5.5 8h5"/>'),
  close: svg('<path d="m4 4 8 8M4 12l8-8"/>'),
  chevron: svg('<path d="m4 6 4 4 4-4"/>'),
  arrow: '<svg class="arrow" viewBox="0 0 16 8" aria-hidden="true" focusable="false"><path d="M0 4h14M10 0l4 4-4 4"/></svg>',
  alert: svg('<path d="M8 2 1.5 13.5h13L8 2Z"/><path d="M8 6.5v3.2M8 11.6v.1"/>'),
};

/** The server's stale message is terse and ends in its own instruction; keep the fact, add one next step. */
function staleDetail(status: string) {
  const changed = status.match(/^review is stale:\s*(.+?)\s+changed\b/i);
  if (changed) return `${changed[1]} changed after this round was prepared.`;
  const text = status.replace(/;?\s*prepare a new round\.?\s*$/i, '').trim();
  return text ? `${text[0].toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? '' : '.'}` : '';
}

type Selection = { type: 'item' | 'region' | 'missing'; id: string };
type Form = { type: 'revise' | 'reclassify'; id: string; region: boolean; text: string; kind: AssetKind };
type MountOptions = {
  preview?: boolean; history?: PlanHistory | null; initialDraft?: PlanDraft; completed?: boolean; status?: string | null;
  onDraftChange?: (draft: PlanDraft) => void; onSubmit: (value: ReturnType<typeof planSubmission>) => Promise<void>;
};

export function mountPlanReview(host: HTMLElement, packet: PlanPacket, options: MountOptions) {
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  let draft: PlanDraft = { ...newPlanDraft(packet), ...structuredClone(options.initialDraft ?? {}) } as PlanDraft;
  draft.reclassify ??= [];
  const queue = planQueue(packet);
  const regions = extraRegions(packet);
  const history = options.history ?? null;
  let selection: Selection | null = (() => {
    const id = nextPending(packet, draft) ?? queue[0]?.id;
    return id ? { type: 'item' as const, id } : regions[0] ? { type: 'region' as const, id: regions[0].id } : null;
  })();
  let form: Form | null = null;
  let marking = false;
  let drag: { x: number; y: number } | null = null;
  let regionsOpen = false;
  let backdrop: 'comp' | 'light' | 'dark' = 'comp';
  let showPrevious = false;
  let sending = false;
  let submitted = !!options.completed;
  let justSent = false;
  let error = '';
  let lastDecision: { label: string; before: PlanDraft; select: Selection } | null = null;
  let resize: ResizeObserver | null = null;
  let strips: (() => void) | null = null;
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const transparency = new Map<string, boolean>();
  const surround = new Map<string, string>();
  let compPixels: { data: Uint8ClampedArray; width: number; height: number } | null = null;

  const item = (id?: string) => packet.components.find(c => c.id === id);
  const region = (id?: string) => regions.find(r => r.id === id);
  const selectedItem = () => selection?.type === 'item' ? item(selection.id) : undefined;
  const selectedRegion = () => selection?.type === 'region' ? region(selection.id) : undefined;
  const selectedMissing = () => selection?.type === 'missing' ? draft.missing.find(m => m.id === selection!.id) : undefined;
  const locked = () => submitted || sending || !!options.status;

  // Comp pixels, once, for the backdrop colour under transparent assets.
  const compImage = new Image();
  compImage.onload = () => {
    try {
      const scale = Math.min(1, 480 / compImage.naturalWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(compImage.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(compImage.naturalHeight * scale));
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(compImage, 0, 0, canvas.width, canvas.height);
      compPixels = { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
      render();
    } catch { /* A tainted or unreadable comp falls back to a neutral backdrop. */ }
  };
  compImage.src = new URL(packet.comp.url, location.href).href;
  function compColour(c: PlanItem) {
    if (!surround.has(c.id) && compPixels) surround.set(c.id, medianColor(ringSamples(compPixels.data, compPixels.width, compPixels.height, c.box)) ?? '');
    return surround.get(c.id) || packet.comp.background || '#e9ebe7';
  }
  function isTransparent(c: PlanItem, src: string) {
    if (c.material?.alpha === 'transparent') return true;
    if (c.material?.alpha === 'opaque') return false;
    if (transparency.has(src)) return transparency.get(src)!;
    transparency.set(src, false);
    if (!/\.(png|webp)(\?|$)/i.test(src)) return false;
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, 160 / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let clear = false;
        for (let i = 3; i < data.length; i += 4) if (data[i] < 250) { clear = true; break; }
        if (clear) { transparency.set(src, true); render(); }
      } catch { /* leave opaque */ }
    };
    img.src = new URL(src, location.href).href;
    return false;
  }

  function commit(next: PlanDraft, label: string) {
    lastDecision = { label, before: draft, select: selection! };
    draft = next;
    form = null;
    error = '';
  }
  function advanceFrom(id: string) {
    const next = nextPending(packet, draft, id);
    if (next) selection = { type: 'item', id: next };
    showPrevious = false;
    render();
    root.getElementById(next ? 'decide-yes' : 'submit')?.focus({ preventScroll: true });
  }
  function approveSelected() {
    const c = selectedItem();
    if (!c || locked() || form) return;
    commit(decide(draft, c, 'approve'), `${c.role === 'asset' ? 'Approved' : 'Kept in code'}: ${c.name}.`);
    advanceFrom(c.id);
  }
  function openForm(type: Form['type']) {
    if (locked()) return;
    const c = selectedItem(), r = selectedRegion();
    const target = c ?? r;
    if (!target) return;
    if (c && type === 'revise' && c.role !== 'asset') return;
    if (c && type === 'reclassify' && c.role !== 'plan') return;
    const saved = c ? currentDecision(c, draft) : undefined;
    const savedRegion = r ? regionReclassify(draft, r.id) : undefined;
    form = { type, id: target.id, region: !!r, text: saved?.action === type ? saved.feedback : savedRegion?.feedback ?? '',
      kind: saved?.kind ?? savedRegion?.kind ?? defaultAssetKind({ name: target.name, note: target.note ?? '', flags: c?.flags }) };
    render();
    root.getElementById('form-text')?.focus();
    root.getElementById('decision-form')?.scrollIntoView({ block: 'nearest' });
  }
  function saveForm() {
    if (!form || locked()) return;
    const f = form;
    if (f.region) {
      const r = region(f.id)!;
      commit(setRegionReclassify(draft, r.id, { kind: f.kind, feedback: f.text }), `${r.name} will become ${assetKindLabel(f.kind).toLowerCase()}.`);
      render();
      root.getElementById('submit')?.focus({ preventScroll: true });
      return;
    }
    const c = item(f.id)!;
    commit(decide(draft, c, f.type, { feedback: f.text, kind: f.kind }), f.type === 'revise' ? `Needs work: ${c.name}.` : `${c.name} will become ${assetKindLabel(f.kind).toLowerCase()}.`);
    advanceFrom(c.id);
  }
  function cancelForm() {
    if (!form) return;
    form = null; render();
    (root.getElementById('decide-no') ?? root.getElementById('decide-image'))?.focus({ preventScroll: true });
  }
  function undo() {
    if (!lastDecision || locked()) return;
    draft = lastDecision.before; selection = lastDecision.select; lastDecision = null; form = null; render();
  }
  function select(next: Selection) {
    if (marking) return;
    if (form && (form.id !== next.id)) form = null;
    selection = next; showPrevious = false; render();
  }
  function step(delta: number) {
    const list: Selection[] = queue.map(c => ({ type: 'item', id: c.id }));
    if (!list.length) return;
    const at = list.findIndex(s => s.id === selection?.id && s.type === selection?.type);
    select(list[(at + delta + list.length) % list.length]);
  }
  async function send() {
    const summary = planSummary(packet, draft);
    if (sending || submitted || form || !summary.canSubmit || options.status) return;
    sending = true; error = ''; render();
    try {
      await options.onSubmit(planSubmission(packet, draft));
      submitted = true; justSent = true; marking = false; lastDecision = null;
    } catch (e) { error = e instanceof Error ? e.message : 'The review could not be saved.'; }
    finally { sending = false; render(); }
  }
  function addMissing(box: Box) {
    const id = `missing-${crypto.randomUUID()}`;
    draft = { ...draft, inventoryConfirmed: false, missing: [...draft.missing, { id, name: '', feedback: '', box }] };
    marking = false; drag = null; form = null; selection = { type: 'missing', id };
    render();
    root.getElementById('missing-name')?.focus();
  }

  // ---------- markup ----------
  const stateLabel = (c: PlanItem) => {
    const s = itemState(c, draft);
    if (s === 'approved') return c.role === 'asset' ? 'Looks good' : 'Code is fine';
    if (s === 'revise') return 'Needs work';
    if (s === 'reclassify') return `Make it ${assetKindLabel(currentDecision(c, draft)!.kind!).toLowerCase()}`;
    if (submitted) return 'Not decided';
    const change = history?.changes[c.id]?.kind;
    return change === 'changed' ? 'Changed · review again' : change === 'added' ? 'New' : 'To decide';
  };
  const stateIcon = (s: string) => s === 'approved' ? ICON.check : s === 'revise' ? ICON.pencil : s === 'reclassify' ? ICON.image : '';
  const roleLine = (c: PlanItem) => isFlagged(c) ? `Flagged · ${c.kind}` : c.role === 'asset' ? `Asset · ${c.kind}` : `Code · ${c.kind}`;
  const thumb = (b: Box, max = 64) => {
    const ratio = (b.w * packet.comp.width) / (b.h * packet.comp.height);
    const h = 40, w = Math.max(28, Math.min(max, h * ratio));
    const fit = ratio > w / h ? { w, h: w / ratio } : { w: h * ratio, h };
    return `<span class="thumb" style="width:${w}px;height:${h}px"><span class="crop" style="width:${fit.w}px;height:${fit.h}px">${compImg(b)}</span></span>`;
  };
  const compImg = (b: Box, alt = '') => `<img src="${url(packet.comp.url)}" alt="${esc(alt)}" draggable="false" style="width:${100 / b.w}%;left:${-100 * b.x / b.w}%;top:${-100 * b.y / b.h}%">`;

  function queueMarkup() {
    const chips = queue.map(c => {
      const s = itemState(c, draft);
      const active = selection?.type === 'item' && selection.id === c.id;
      return `<button class="chip ${s} ${isFlagged(c) ? 'flagged' : ''} is-${c.role}" data-item="${esc(c.id)}" role="tab" aria-selected="${active}" aria-label="${esc(`${c.name}, ${roleLine(c)}, ${stateLabel(c)}`)}">${thumb(c.box)}<span class="chip-text"><strong>${esc(c.name)}</strong><span>${esc(roleLine(c))}</span></span><span class="chip-state" title="${esc(stateLabel(c))}">${stateIcon(s)}</span></button>`;
    }).join('');
    const reclassified = regions.filter(r => regionReclassify(draft, r.id)).length;
    return `<nav class="queue" aria-label="Items to decide">
      <div class="queue-head"><h2>To decide</h2><span>${(() => { const p = planSummary(packet, draft).pending; return submitted ? 'Read-only' : p ? `${p} left` : queue.length ? 'All decided' : ''; })()}</span></div>
      <div class="queue-list">${chips || '<p class="queue-empty">Nothing needs a decision. Check the comp for anything missing.</p>'}</div>
      ${regions.length ? `<button id="regions-toggle" class="disclosure" aria-expanded="${regionsOpen}" aria-controls="region-list">${ICON.chevron}<span><strong>${regions.length} more ${regions.length === 1 ? 'region' : 'regions'} set in code${reclassified ? ` · ${reclassified} changing` : ''}</strong><span>Checked in the first-viewport review</span></span></button>` : ''}
    </nav>
    ${regions.length && regionsOpen ? `<div id="region-list" class="region-list ks-tab-list" role="tablist" aria-label="Regions set in code">${regions.map(r => {
      const re = regionReclassify(draft, r.id);
      const active = selection?.type === 'region' && selection.id === r.id;
      return `<button role="tab" data-region="${esc(r.id)}" aria-selected="${active}" class="${re ? 'reclassify' : ''}">${esc(r.name)}<small>${esc(re ? `to ${assetKindLabel(re.kind).toLowerCase()}` : r.kind)}</small></button>`;
    }).join('')}</div>` : ''}`;
  }

  function mapMarkup() {
    type Shape = { key: string; kind: 'item' | 'region' | 'missing'; id: string; name: string; box: Box; cls: string; label: string };
    const shapes: Shape[] = [
      ...regions.map(r => ({ key: `r:${r.id}`, kind: 'region' as const, id: r.id, name: r.name, box: r.box, cls: `code ${regionReclassify(draft, r.id) ? 'reclassify' : ''}`, label: `${r.name}, set in code (${r.kind})` })),
      ...packet.components.map(c => ({ key: `i:${c.id}`, kind: 'item' as const, id: c.id, name: c.name, box: c.box, cls: `is-${c.role} ${isFlagged(c) ? 'flagged' : ''} ${itemState(c, draft)}`, label: `${c.name}, ${roleLine(c)}, ${stateLabel(c)}` })),
      ...draft.missing.map(m => ({ key: `m:${m.id}`, kind: 'missing' as const, id: m.id, name: m.name || 'Missing', box: m.box, cls: 'missing', label: `Missing: ${m.name || 'unnamed'}` })),
    ].sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
    return shapes.map(s => {
      const active = selection?.type === s.kind && selection.id === s.id;
      return `<button class="region ${s.cls} ${active ? 'selected' : ''} ${s.box.y < .06 ? 'tag-below' : ''} ${s.box.x > .7 ? 'tag-right' : ''}" style="${boxStyle(s.box)}" data-${s.kind}="${esc(s.id)}" aria-label="${esc(s.label)}" aria-pressed="${active}"><span class="tag">${esc(s.name)}</span></button>`;
    }).join('');
  }

  function stageMarkup(c: PlanItem | undefined, r: CodeRegion | undefined) {
    if (c?.role === 'asset') {
      const prior = history?.changes[c.id]?.kind === 'changed' ? history.packet.components.find(p => p.id === c.id)?.preview.url : undefined;
      const src = showPrevious && prior ? prior : c.preview.url;
      if (!src) return `<div class="stage"><p class="stage-empty">This asset has no generated file.</p></div>`;
      const clear = isTransparent(c, src);
      const bg = backdrop === 'light' ? '#f6f6f3' : backdrop === 'dark' ? '#1d201e' : compColour(c);
      return `<div class="stage pair" data-ratio="${(c.box.w * packet.comp.width) / (c.box.h * packet.comp.height)}" data-natural="${c.box.w * packet.comp.width}x${c.box.h * packet.comp.height}">
        <figure><figcaption>In the comp</figcaption><div class="frame crop">${compImg(c.box, `Comp region for ${c.name}`)}</div></figure>
        <figure><figcaption>${showPrevious && prior ? `Previous version · round ${history!.packet.round}` : 'Generated asset'}</figcaption><div class="frame asset ${clear ? 'clear' : ''}" style="${clear ? `background:${esc(bg)}` : ''}"><img src="${url(src)}" alt="Generated ${esc(c.name)}" draggable="false"></div></figure>
      </div>
      ${clear || prior ? `<div class="stage-tools">${prior ? `<div class="ks-instrument-strip is-paper" data-ks-strip="version" role="group" aria-label="Asset version"><button type="button" class="ks-instrument-key" id="ver-current" aria-pressed="${!showPrevious}">Current</button><button type="button" class="ks-instrument-key" id="ver-previous" aria-pressed="${showPrevious}">Previous</button></div>` : '<span></span>'}${clear ? `<div class="tool"><span class="tool-label">Backdrop</span><div class="ks-instrument-strip is-paper" data-ks-strip="backdrop" role="group" aria-label="Backdrop behind the transparent asset">${(['comp', 'light', 'dark'] as const).map(b => `<button type="button" class="ks-instrument-key" data-backdrop="${b}" aria-pressed="${backdrop === b}">${b === 'comp' ? 'Comp' : b === 'light' ? 'Light' : 'Dark'}</button>`).join('')}</div></div>` : ''}</div>` : ''}`;
    }
    const target = c ?? r;
    if (!target) return '';
    return `<div class="stage single" data-box="${esc(JSON.stringify(target.box))}">
      <figure><figcaption>In the comp</figcaption><div class="frame crop"><img src="${url(packet.comp.url)}" alt="Comp around ${esc(target.name)}" draggable="false"><span class="focus-box"></span></div></figure>
    </div>`;
  }

  function decideMarkup(c: PlanItem | undefined, r: CodeRegion | undefined) {
    const kbd = (k: string) => `<kbd>${k}</kbd>`;
    if (form) {
      const reclass = form.type === 'reclassify';
      return `<form id="decision-form" class="decision-form">
        ${reclass ? `<div class="kinds"><span class="tool-label" id="kinds-label">Make it an image as</span><div class="ks-instrument-strip is-paper" data-ks-strip="kind" role="group" aria-labelledby="kinds-label">${ASSET_KINDS.map(k => `<button type="button" class="ks-instrument-key" data-kind="${k.kind}" aria-pressed="${form!.kind === k.kind}">${k.label}</button>`).join('')}</div><p class="kind-hint" id="kind-hint">${esc(ASSET_KINDS.find(k => k.kind === form!.kind)!.hint)}.</p></div>` : ''}
        <label class="field">${reclass ? 'Anything the image should keep? <span>Optional</span>' : 'What needs to change? <span>Optional</span>'}<textarea id="form-text" rows="3" placeholder="${reclass ? 'For example: keep the brushed direction horizontal.' : 'For example: the figure should face the sea.'}">${esc(form.text)}</textarea></label>
        <div class="form-actions"><button type="button" id="form-cancel" class="ks-button ks-button-ghost">Cancel</button><button type="submit" class="ks-button ks-button-primary">${reclass ? 'Make it an image' : 'Save feedback'}${ksArrow}</button></div>
      </form>`;
    }
    if (r) {
      const re = regionReclassify(draft, r.id);
      if (re) return `<div class="verdict reclassify"><p><strong>Will become ${esc(assetKindLabel(re.kind).toLowerCase())}.</strong>${re.feedback ? ` ${esc(re.feedback)}` : ''}</p>${submitted ? '' : '<div class="verdict-actions"><button id="region-edit" class="text-action">Edit</button><button id="region-keep" class="text-action">Keep in code</button></div>'}</div>`;
      return `<div class="region-note"><p>No decision needed. Text, controls and layout are judged in the first-viewport review, once the page is built.</p>${submitted ? '' : `<button id="decide-image" class="ks-button ks-button-secondary">Make it an image</button>`}</div>`;
    }
    if (!c) return '';
    const d = currentDecision(c, draft);
    if (submitted) {
      return `<div class="verdict ${d ? itemState(c, draft) : 'pending'}"><p><strong>${d ? esc(stateLabel(c)) : 'Not decided'}.</strong>${d?.feedback ? ` ${esc(d.feedback)}` : ''}</p></div>`;
    }
    const yes = c.role === 'asset' ? 'Looks good' : 'Code is fine';
    const no = c.role === 'asset' ? 'Needs work' : 'Make it an image';
    const s = itemState(c, draft);
    return `<div class="decisions" role="group" aria-label="Decision for ${esc(c.name)}">
        <button id="decide-yes" class="ks-button ks-button-primary">${yes}</button>
        <button id="decide-no" class="ks-button ks-button-secondary">${no}</button>
      </div>
      ${d ? `<div class="verdict ${s}"><p><strong>${esc(stateLabel(c))}.</strong>${d.feedback ? ` ${esc(d.feedback)}` : d.action === 'approve' ? '' : ' No note; the agent will diagnose.'}</p><div class="verdict-actions"><button id="decision-edit" class="text-action">Edit</button><button id="decision-clear" class="text-action">Clear</button></div></div>` : ''}`;
  }

  function detailMarkup() {
    const c = selectedItem(), r = selectedRegion(), m = selectedMissing();
    if (m) return `<div class="detail-head"><div><p class="eyebrow missing">Missing from the comp</p><h2>${esc(m.name || 'Name the missing piece')}</h2></div></div>
      ${stageMarkup(undefined, { id: m.id, name: m.name || 'the missing piece', kind: 'missing', box: m.box })}
      <div class="missing-form"><label class="field">Name<input id="missing-name" value="${esc(m.name)}" placeholder="For example: harbour boat" ${locked() ? 'disabled' : ''}></label>
      <label class="field">What is missing? <span>Optional</span><textarea id="missing-feedback" rows="3" ${locked() ? 'disabled' : ''}>${esc(m.feedback)}</textarea></label>
      ${locked() ? '' : '<button id="missing-remove" class="ks-button ks-button-ghost">Remove this mark</button>'}</div>`;
    if (!c && !r) return `<div class="detail-empty"><p>Select a region on the comp.</p></div>`;
    const flags = c?.role === 'plan' ? [...(c.flags ?? []).map(flagMessage), ...(c.codeDrawn ? ['The plan draws this artwork in code. Painted work drawn in code usually reads as a stand-in.'] : [])] : [];
    const eyebrow = c ? (c.role === 'asset' ? `Generated asset · ${c.kind}` : `Planned in code · ${c.kind}`) : `Set in code · ${r!.kind}`;
    const s = c ? itemState(c, draft) : regionReclassify(draft, r!.id) ? 'reclassify' : 'code';
    const pill = c ? `<span class="pill ${s}">${stateIcon(s)}${esc(stateLabel(c))}</span>` : '';
    const change = c && history?.changes[c.id];
    const note = (c?.note ?? r?.note ?? '').trim();
    return `<div class="detail-head"><div><p class="eyebrow ${c && isFlagged(c) ? 'flagged' : ''}">${esc(eyebrow)}</p><h2>${esc((c ?? r)!.name)}</h2></div>${pill}</div>
      ${flags.length ? `<div class="flag" role="note">${ICON.alert}<div>${flags.map(f => `<p>${esc(f)}</p>`).join('')}</div></div>` : ''}
      ${change?.kind === 'changed' ? `<p class="change-note">Changed since round ${history!.packet.round}${change.files.length ? `: ${esc(change.files.join(', '))}` : ''}.</p>` : ''}
      ${stageMarkup(c, r)}
      <div class="plan-copy">${c?.role === 'asset' ? (note ? `<p class="note">${esc(note)}</p>` : '') : `<p class="statement">${c ? `<strong>Planned:</strong> ${esc(planStatement(c).replace(/^D/, 'd'))}` : `<strong>${esc(planStatement(r!))}</strong>`}</p>${note ? `<p class="note">${esc(note)}</p>` : ''}`}</div>
      <div class="decide">${decideMarkup(c, r)}</div>`;
  }

  function bannerMarkup() {
    if (options.status) return `<div class="banner stale" role="alert">${ICON.alert}<div><strong>This review is out of date.</strong><p>${esc(staleDetail(options.status))} Ask the agent to prepare a new round, then reload this page.</p></div><button id="reload" class="ks-button ks-button-secondary">Reload</button></div>`;
    if (error) return `<div class="banner error" role="alert">${ICON.alert}<div><strong>Your decisions were not sent.</strong><p>${esc(error)}</p></div><button id="retry" class="ks-button ks-button-secondary">Try again</button></div>`;
    if (submitted) {
      const s = planSummary(packet, draft);
      return `<div class="banner done" role="status">${ICON.check}<div><strong>${s.hasChanges ? 'Changes sent.' : 'Plan and assets approved.'}</strong><p>${s.hasChanges ? 'The agent applies them and opens a new round for anything that changed.' : 'The agent continues to the first viewport.'}${justSent ? '' : ' This round is read-only.'}</p></div></div>`;
    }
    return '';
  }

  function footerMarkup() {
    const s = planSummary(packet, draft);
    if (submitted) return `<footer><span class="progress">Round ${packet.round} · read-only</span><span class="progress">${s.approved} approved${s.revise ? ` · ${s.revise} need${s.revise === 1 ? 's' : ''} work` : ''}${s.reclassify ? ` · ${s.reclassify} to become images` : ''}${s.missing ? ` · ${s.missing} missing` : ''}</span></footer>`;
    const parts = [s.revise ? `${s.revise} need${s.revise === 1 ? 's' : ''} work` : '', s.reclassify ? `${s.reclassify} to become ${s.reclassify === 1 ? 'an image' : 'images'}` : '', s.missing ? `${s.missing} missing` : ''].filter(Boolean);
    const helper = form ? 'Save or cancel the open note first.'
      : options.status ? 'This round can no longer be sent.'
      : s.mode === 'changes' ? `${parts.join(' · ')}.${s.pending ? ` ${s.pending} undecided stay open.` : ''}`
      : s.pending ? `${s.pending} left to decide. Approval confirms nothing is missing from the comp.`
      : 'Approval confirms nothing is missing from the comp.';
    const disabled = !s.canSubmit || !!form || sending || !!options.status;
    return `<footer>
      <button id="mark" class="ks-button ks-button-ghost mark" aria-pressed="${marking}">${marking ? 'Cancel marking' : 'Mark missing'}</button>
      <div class="progress" role="status">${lastDecision ? `<span>${esc(lastDecision.label)}</span><button id="undo" class="text-action">Undo</button>` : options.status ? '' : `<span class="keys"><kbd>A</kbd> approve <kbd>N</kbd> change <kbd>J</kbd><kbd>K</kbd> move</span>`}</div>
      <div class="submit"><p>${esc(helper)}</p><button id="submit" class="ks-button ks-button-primary" ${disabled ? 'disabled' : ''}>${sending ? 'Sending…' : s.mode === 'changes' ? 'Send changes' : 'Approve plan and assets'}${sending ? '' : ksArrow}</button></div>
    </footer>`;
  }

  function render() {
    resize?.disconnect();
    strips?.();
    const active = root.activeElement as HTMLElement | null;
    const focusId = active?.id;
    const focusKey = active?.dataset.item ?? active?.dataset.region;
    const queueLeft = root.querySelector('.queue-list')?.scrollLeft ?? 0;
    const textSel = active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement ? [active.selectionStart, active.selectionEnd] : null;
    root.innerHTML = `<style>${planStyles}</style><section class="plan-review ${submitted ? 'is-submitted' : ''}" aria-label="Plan and asset review">
      <header><div class="titles"><h1>${submitted ? 'Plan and asset review.' : 'Review the plan and assets.'}</h1><p>Generated images, and what will be drawn in code, before any page code is written.</p></div>
        <div class="meta"><span class="surface">${esc(packet.title)}</span><span>Round ${packet.round}</span>${submitted ? '<span class="badge">Submitted · read-only</span>' : options.preview ? '<span class="badge">Preview</span>' : ''}</div></header>
      ${bannerMarkup()}
      ${queueMarkup()}
      <div class="work">
        <section class="map-pane" aria-label="Approved comp">
          <div class="map-space"><div class="map ${marking ? 'marking' : ''} ${selection ? 'has-selection' : ''}"><img class="comp" src="${url(packet.comp.url)}" alt="Approved comp for ${esc(packet.title)}" draggable="false">${mapMarkup()}<div class="draw-box" hidden></div></div></div>
          <div class="legend">${marking ? '<span class="marking-hint">Drag on the comp around what is missing.</span>' : `<span><i class="lg asset"></i>Generated asset</span><span><i class="lg plan"></i>Planned in code</span><span><i class="lg flagged"></i>Flagged</span>${regions.length ? '<span><i class="lg code"></i>Set in code (hover)</span>' : ''}${draft.missing.length ? '<span><i class="lg missing"></i>Missing</span>' : ''}`}</div>
        </section>
        <section class="detail" aria-label="Selected item">${detailMarkup()}</section>
      </div>
      ${footerMarkup()}
    </section>`;
    const list = root.querySelector('.queue-list');
    if (list) list.scrollLeft = queueLeft;
    if (focusId) {
      const el = root.getElementById(focusId) as HTMLElement | null;
      el?.focus({ preventScroll: true });
      if (textSel && (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)) try { el.setSelectionRange(textSel[0], textSel[1]); } catch { /* number inputs */ }
    } else if (focusKey) root.querySelector<HTMLElement>(`[data-item="${CSS.escape(focusKey)}"],[data-region="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    root.querySelector('.chip[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    wire();
    layout();
    const work = root.querySelector<HTMLElement>('.work')!;
    resize = new ResizeObserver(layout); resize.observe(work);
    strips = initInstrumentStrips(root);
    if (!submitted) options.onDraftChange?.(structuredClone(draft));
  }

  function layout() {
    const space = root.querySelector<HTMLElement>('.map-space'), map = root.querySelector<HTMLElement>('.map');
    if (space && map) {
      const narrow = matchMedia('(max-width: 820px)').matches;
      const w = space.clientWidth, h = narrow ? Infinity : space.clientHeight;
      const scale = Math.min(w / packet.comp.width, h / packet.comp.height);
      map.style.width = `${packet.comp.width * scale}px`; map.style.height = `${packet.comp.height * scale}px`;
    }
    const caption = 26, gap = 16;
    const pair = root.querySelector<HTMLElement>('.stage.pair');
    if (pair) {
      const ratio = Number(pair.dataset.ratio);
      const [nw, nh] = (pair.dataset.natural ?? '0x0').split('x').map(Number);
      const fit = pairLayout(ratio, pair.clientWidth, pair.clientHeight, gap, caption, 4, { w: nw, h: nh });
      pair.dataset.direction = fit.direction;
      pair.querySelectorAll<HTMLElement>('.frame').forEach(f => { f.style.width = `${Math.floor(fit.w)}px`; f.style.height = `${Math.floor(fit.h)}px`; });
    }
    const single = root.querySelector<HTMLElement>('.stage.single');
    if (single?.clientWidth) {
      const box = JSON.parse(single.dataset.box!) as Box;
      const fit = planView(box, packet.comp.width, packet.comp.height, single.clientWidth, Math.max(60, single.clientHeight - caption));
      const frame = single.querySelector<HTMLElement>('.frame')!, img = frame.querySelector<HTMLElement>('img')!, focus = frame.querySelector<HTMLElement>('.focus-box')!;
      const v = fit.view;
      frame.style.width = `${Math.floor(fit.width)}px`; frame.style.height = `${Math.floor(fit.height)}px`;
      img.style.cssText = `width:${100 / v.w}%;left:${-100 * v.x / v.w}%;top:${-100 * v.y / v.h}%`;
      focus.style.cssText = boxStyle({ x: (box.x - v.x) / v.w, y: (box.y - v.y) / v.h, w: box.w / v.w, h: box.h / v.h });
    }
  }

  function wire() {
    const on = (id: string, fn: () => void) => root.getElementById(id)?.addEventListener('click', fn);
    root.querySelectorAll<HTMLElement>('[data-item]').forEach(el => el.addEventListener('click', () => select({ type: 'item', id: el.dataset.item! })));
    root.querySelectorAll<HTMLElement>('[data-region]').forEach(el => el.addEventListener('click', () => select({ type: 'region', id: el.dataset.region! })));
    root.querySelectorAll<HTMLElement>('[data-missing]').forEach(el => el.addEventListener('click', () => select({ type: 'missing', id: el.dataset.missing! })));
    on('regions-toggle', () => { regionsOpen = !regionsOpen; render(); });
    on('decide-yes', approveSelected);
    on('decide-no', () => openForm(selectedItem()?.role === 'asset' ? 'revise' : 'reclassify'));
    on('decide-image', () => openForm('reclassify'));
    on('decision-edit', () => openForm(selectedItem()?.role === 'asset' ? 'revise' : 'reclassify'));
    on('decision-clear', () => { const c = selectedItem(); if (c && !locked()) { commit(clearDecision(draft, c.id), `Cleared: ${c.name}.`); render(); } });
    on('region-edit', () => openForm('reclassify'));
    on('region-keep', () => { const r = selectedRegion(); if (r && !locked()) { commit(setRegionReclassify(draft, r.id, null), `${r.name} stays in code.`); render(); } });
    on('form-cancel', cancelForm);
    root.getElementById('decision-form')?.addEventListener('submit', e => { e.preventDefault(); saveForm(); });
    root.getElementById('form-text')?.addEventListener('input', e => { if (form) form.text = (e.target as HTMLTextAreaElement).value; });
    root.querySelectorAll<HTMLElement>('[data-kind]').forEach(el => el.addEventListener('click', () => {
      if (!form) return;
      form.kind = el.dataset.kind as AssetKind;
      root.querySelectorAll<HTMLElement>('[data-kind]').forEach(k => k.setAttribute('aria-pressed', String(k === el)));
      const hint = root.getElementById('kind-hint'); if (hint) hint.textContent = `${ASSET_KINDS.find(k => k.kind === form!.kind)!.hint}.`;
    }));
    root.querySelectorAll<HTMLElement>('[data-backdrop]').forEach(el => el.addEventListener('click', () => { backdrop = el.dataset.backdrop as typeof backdrop; render(); }));
    on('ver-current', () => { showPrevious = false; render(); });
    on('ver-previous', () => { showPrevious = true; render(); });
    on('undo', undo);
    on('submit', () => void send());
    on('retry', () => void send());
    on('reload', () => location.reload());
    on('mark', () => { if (locked()) return; marking = !marking; form = null; render(); });
    on('missing-remove', () => { const m = selectedMissing(); if (!m) return; draft = { ...draft, missing: draft.missing.filter(x => x.id !== m.id) }; selection = queue[0] ? { type: 'item', id: queue[0].id } : null; render(); });
    const syncSubmit = () => { const b = root.getElementById('submit') as HTMLButtonElement | null; if (b) b.disabled = !planSummary(packet, draft).canSubmit || !!form || sending || !!options.status; };
    root.getElementById('missing-name')?.addEventListener('input', e => { const m = selectedMissing(); if (m) { m.name = (e.target as HTMLInputElement).value; syncSubmit(); options.onDraftChange?.(structuredClone(draft)); } });
    root.getElementById('missing-name')?.addEventListener('change', () => render());
    root.getElementById('missing-feedback')?.addEventListener('input', e => { const m = selectedMissing(); if (m) { m.feedback = (e.target as HTMLTextAreaElement).value; options.onDraftChange?.(structuredClone(draft)); } });
    if (locked()) root.querySelectorAll<HTMLButtonElement>('#mark,#decide-yes,#decide-no,#decide-image,#decision-edit,#decision-clear,#region-edit,#region-keep').forEach(b => b.disabled = true);

    const map = root.querySelector<HTMLElement>('.map');
    if (!map) return;
    const point = (e: PointerEvent) => { const r = map.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }; };
    let box: Box | null = null;
    map.addEventListener('pointerdown', e => { if (!marking) return; drag = point(e); box = null; map.setPointerCapture(e.pointerId); e.preventDefault(); });
    map.addEventListener('pointermove', e => {
      if (!drag) return;
      const p = point(e);
      box = { x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) };
      const outline = root.querySelector<HTMLElement>('.draw-box')!; outline.hidden = false; outline.style.cssText = boxStyle(box);
    });
    map.addEventListener('pointerup', () => { if (box && box.w > .01 && box.h > .01) addMissing(box); else { drag = null; box = null; } });
    map.addEventListener('pointercancel', () => { drag = null; box = null; render(); });
  }

  const onKey = (event: Event) => {
    const e = event as KeyboardEvent;
    if (!host.isConnected || e.defaultPrevented) return;
    const target = e.composedPath()[0] as HTMLElement;
    const typing = target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && target.type !== 'radio');
    if (e.key === 'Escape') { if (form) { e.preventDefault(); cancelForm(); } else if (marking) { e.preventDefault(); marking = false; render(); } return; }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && form) { e.preventDefault(); saveForm(); return; }
    if (typing || e.altKey || e.isComposing || locked()) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { if (lastDecision) { e.preventDefault(); undo(); } return; }
    if (e.metaKey || e.ctrlKey || form) return;
    const key = e.key.toLowerCase();
    if (key === 'a' && selectedItem()) { e.preventDefault(); approveSelected(); }
    else if (key === 'n' && (selectedItem() || selectedRegion())) { e.preventDefault(); if (selectedRegion()) openForm('reclassify'); else root.getElementById('decide-no')?.click(); }
    else if (key === 'j' || (e.key === 'ArrowRight' && !(target instanceof HTMLInputElement))) { e.preventDefault(); step(1); }
    else if (key === 'k' || (e.key === 'ArrowLeft' && !(target instanceof HTMLInputElement))) { e.preventDefault(); step(-1); }
  };
  document.addEventListener('keydown', onKey);

  render();
  return { destroy() { resize?.disconnect(); strips?.(); document.removeEventListener('keydown', onKey); root.replaceChildren(); }, getDraft(): PlanDraft { return structuredClone(draft); } };
}
