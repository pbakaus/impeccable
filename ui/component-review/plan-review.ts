/** Plan and asset review (packet schemaVersion 3, stage components). Contract: docs/PLAN-REVIEW.md;
 * design brief: DESIGN-stage.md. An intro, then one item at a time on a full stage, then a summary
 * with the coverage question and the single submit. The first-viewport stage keeps review.ts. */
import {
  ASSET_KINDS, clearDecision, currentDecision, decide, defaultAssetKind, extraRegions, figureLayout,
  flagMessage, introLine, isFlagged, itemState, loupeOffset, medianColor, newPlanDraft, planQueue, planStatement,
  planSubmission, planSummary, planView, priorRound, progressLights, regionReclassify, ringSamples, sendLabel,
  setRegionReclassify,
  type AssetKind, type PlanDraft, type PlanHistory, type PlanItem, type PlanPacket,
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
  alert: svg('<path d="M8 2 1.5 13.5h13L8 2Z"/><path d="M8 6.5v3.2M8 11.6v.1"/>'),
};
const kbd = (k: string) => `<kbd class="cap">${k}</kbd>`;
const KIND_WORD: Record<string, string> = { plate: 'illustration', image: 'photo', texture: 'texture' };

/** The server's stale message is terse and ends in its own instruction; keep the fact, add one next step. */
function staleDetail(status: string) {
  const changed = status.match(/^review is stale:\s*(.+?)\s+changed\b/i);
  if (changed) return `${changed[1]} changed after this round was prepared.`;
  const text = status.replace(/;?\s*prepare a new round\.?\s*$/i, '').trim();
  return text ? `${text[0].toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? '' : '.'}` : '';
}
const storage = {
  get(key: string) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
};

type View = 'intro' | 'stage' | 'summary';
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
  const params = new URLSearchParams(location.search);
  let submitted = !!options.completed;
  let view: View = submitted ? 'summary' : (['intro', 'stage', 'summary'].includes(params.get('view') ?? '') ? params.get('view') as View : 'intro');
  let current = (params.get('item') && queue.some(c => c.id === params.get('item')) ? params.get('item')! : undefined)
    ?? queue.find(c => itemState(c, draft) === 'pending')?.id ?? queue[0]?.id;
  let enter: 'next' | 'prev' | 'fade' | null = null;
  let form: Form | null = null;
  let panel: { type: 'region' | 'missing'; id: string } | null = null;
  let marking = false;
  let mapOpen = false;
  let flipped = false;
  const backdrop: Record<string, 'comp' | 'light' | 'dark'> = {};
  let sending = false;
  let justSent = false;
  let error = '';
  let toast: { label: string; before: PlanDraft; view: View; current?: string; timer: number } | null = null;
  let hintSeen = storage.get('impeccable.review.flipHint') === '1';
  let resize: ResizeObserver | null = null;
  let strips: (() => void) | null = null;
  const transparency = new Map<string, boolean>();
  const surround = new Map<string, string>();
  let compPixels: { data: Uint8ClampedArray; width: number; height: number } | null = null;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const item = (id?: string) => packet.components.find(c => c.id === id);
  const region = (id?: string) => regions.find(r => r.id === id);
  const locked = () => submitted || sending || !!options.status;
  const boxRatio = (b: Box) => (b.w * packet.comp.width) / (b.h * packet.comp.height);

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
      if (view === 'stage') render();
    } catch { /* A tainted or unreadable comp falls back to a neutral backdrop. */ }
  };
  compImage.src = new URL(packet.comp.url, location.href).href;
  function compColour(c: PlanItem) {
    if (!surround.has(c.id) && compPixels) surround.set(c.id, medianColor(ringSamples(compPixels.data, compPixels.width, compPixels.height, c.box)) ?? '');
    return surround.get(c.id) || packet.comp.background || 'var(--ks-paper-deep)';
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
        for (let i = 3; i < data.length; i += 4) if (data[i] < 250) { transparency.set(src, true); if (view === 'stage') render(); break; }
      } catch { /* leave opaque */ }
    };
    img.src = new URL(src, location.href).href;
    return false;
  }

  // ---------- actions ----------
  function go(next: View, id?: string, how: typeof enter = 'fade') {
    if (id) current = id;
    enter = reduced() ? null : how;
    view = next; form = null; flipped = false; mapOpen = false;
    if (next !== 'summary') { panel = null; marking = false; }
    render();
    const focus = next === 'intro' ? 'start' : next === 'stage' ? 'decide-yes' : 'send';
    root.getElementById(focus)?.focus({ preventScroll: true });
  }
  function move(delta: number) {
    if (view !== 'stage' || !queue.length) return;
    const next = queue.findIndex(c => c.id === current) + delta;
    if (next >= queue.length) return go('summary', undefined, 'next');
    if (next < 0) return;
    go('stage', queue[next].id, delta > 0 ? 'next' : 'prev');
  }
  function showToast(label: string, before: PlanDraft) {
    if (toast) clearTimeout(toast.timer);
    toast = { label, before, view, current, timer: window.setTimeout(() => { toast = null; root.querySelector('.toast')?.classList.add('gone'); }, 6000) };
  }
  function commit(next: PlanDraft, label: string) {
    const before = draft;
    draft = next; form = null; error = '';
    showToast(label, before);
  }
  function advance() {
    const at = queue.findIndex(c => c.id === current);
    const next = [...queue.slice(at + 1), ...queue.slice(0, at + 1)].find(c => itemState(c, draft) === 'pending');
    if (next) go('stage', next.id, 'next'); else go('summary', undefined, 'next');
  }
  function approve() {
    const c = item(current);
    if (view !== 'stage' || !c || locked() || form) return;
    commit(decide(draft, c, 'approve'), `${c.role === 'asset' ? 'Approved' : 'Kept in code'}: ${c.name}.`);
    advance();
  }
  function openForm(type: Form['type'], regionId?: string) {
    if (locked()) return;
    const r = regionId ? region(regionId) : undefined;
    const c = r ? undefined : item(current);
    const target = c ?? r;
    if (!target || (c && type === 'reclassify' && c.role !== 'plan')) return;
    const saved = c ? currentDecision(c, draft) : undefined;
    const savedRegion = r ? regionReclassify(draft, r.id) : undefined;
    form = { type, id: target.id, region: !!r, text: saved?.action === type ? saved.feedback : savedRegion?.feedback ?? '',
      kind: saved?.kind ?? savedRegion?.kind ?? defaultAssetKind({ name: target.name, note: target.note ?? '', flags: c?.flags }) };
    render();
    root.getElementById('form-text')?.focus();
  }
  function saveForm() {
    if (!form || locked()) return;
    const f = form;
    if (f.region) {
      const r = region(f.id)!;
      commit(setRegionReclassify(draft, r.id, { kind: f.kind, feedback: f.text }), `${r.name} will become ${KIND_WORD[f.kind]}.`);
      render();
      return;
    }
    const c = item(f.id)!;
    if (f.type === 'revise' && c.role === 'plan' && !f.text.trim()) { root.getElementById('form-text')?.focus(); return; }
    commit(decide(draft, c, f.type, { feedback: f.text, kind: f.kind }), f.type === 'revise' ? `Noted: ${c.name}.` : `${c.name} will become ${KIND_WORD[f.kind]}.`);
    advance();
  }
  function undo() {
    if (!toast || locked()) return;
    const t = toast; clearTimeout(t.timer); toast = null;
    draft = t.before;
    go(t.view, t.current, 'prev');
  }
  async function send() {
    const summary = planSummary(packet, draft);
    if (sending || submitted || form || !summary.canSubmit || options.status) return;
    sending = true; error = ''; render();
    try {
      await options.onSubmit(planSubmission(packet, draft));
      submitted = true; justSent = true; marking = false; toast = null;
    } catch (e) { error = e instanceof Error ? e.message : 'The review could not be saved.'; }
    finally { sending = false; render(); }
  }
  function addMissing(box: Box) {
    const id = `missing-${crypto.randomUUID()}`;
    draft = { ...draft, inventoryConfirmed: false, missing: [...draft.missing, { id, name: '', feedback: '', box }] };
    marking = false; panel = { type: 'missing', id };
    render();
    root.getElementById('missing-name')?.focus();
  }

  // ---------- pieces ----------
  const stateWord = (c: PlanItem) => {
    const s = itemState(c, draft);
    if (s === 'approved') return c.role === 'asset' ? 'Looks good' : 'Code is fine';
    if (s === 'revise') return 'Needs work';
    if (s === 'reclassify') return `Becomes ${KIND_WORD[currentDecision(c, draft)!.kind!]}`;
    return submitted ? 'Not decided' : 'To decide';
  };
  const compLayer = (b: Box, cls = '') => `<span class="pic crop ${cls}"><img src="${url(packet.comp.url)}" alt="" draggable="false" style="width:${100 / b.w}%;left:${-100 * b.x / b.w}%;top:${-100 * b.y / b.h}%"></span>`;
  const genLayer = (c: PlanItem, src: string, cls = 'gen') => {
    const clear = isTransparent(c, src);
    const bd = backdrop[c.id] ?? 'comp';
    const bg = !clear ? '' : bd === 'light' ? 'var(--ks-paper-raised)' : bd === 'dark' ? 'var(--ks-instrument)' : compColour(c);
    return `<span class="pic ${cls}" style="${bg ? `background:${esc(bg)}` : ''}"><img src="${url(src)}" alt="" draggable="false"></span>`;
  };
  function regionsOverlay(opts: { code: boolean; interactive: boolean }) {
    type Shape = { kind: 'item' | 'region' | 'missing'; id: string; name: string; box: Box; cls: string };
    const shapes: Shape[] = [
      ...(opts.code ? regions.map(r => ({ kind: 'region' as const, id: r.id, name: r.name, box: r.box, cls: `code ${regionReclassify(draft, r.id) ? 'reclassify' : ''}` })) : []),
      ...packet.components.map(c => ({ kind: 'item' as const, id: c.id, name: c.name, box: c.box, cls: `is-${c.role} ${isFlagged(c) ? 'flagged' : ''} ${itemState(c, draft)}` })),
      ...draft.missing.map(m => ({ kind: 'missing' as const, id: m.id, name: m.name || 'Missing', box: m.box, cls: 'missing' })),
    ].sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
    return shapes.map(s => {
      const active = panel?.id === s.id || (mapOpen && view === 'stage' && s.id === current);
      const tag = `<span class="tag">${esc(s.name)}</span>`;
      return opts.interactive
        ? `<button type="button" class="region ${s.cls} ${active ? 'selected' : ''} ${s.box.y < .06 ? 'tag-below' : ''} ${s.box.x > .7 ? 'tag-right' : ''}" style="${boxStyle(s.box)}" data-${s.kind}="${esc(s.id)}" aria-label="${esc(s.name)}">${tag}</button>`
        : `<span class="region ${s.cls}" style="${boxStyle(s.box)}"></span>`;
    }).join('');
  }

  function topBar() {
    const lights = progressLights(packet, draft, view === 'stage' ? current : undefined);
    const doneCount = lights.filter(l => l.state !== 'pending').length;
    return `<header class="bar">
      <div class="bar-title"><span class="bar-name">${esc(packet.title)}</span><span class="bar-round">Round ${packet.round}</span></div>
      ${queue.length ? `<nav class="lights ${lights.length > 20 ? 'dense' : ''}" aria-label="Progress, ${doneCount} of ${lights.length} decided">${lights.map((l, i) => `<button type="button" class="light ${l.state === 'pending' ? '' : 'decided'} ${l.current ? 'current' : ''}" data-go="${esc(l.id)}" aria-label="${esc(`${i + 1}. ${l.name}: ${stateWord(item(l.id)!)}`)}" ${l.current ? 'aria-current="step"' : ''}><span class="tip">${esc(l.name)}</span></button>`).join('')}<button type="button" class="lights-summary ${view === 'summary' ? 'current' : ''}" id="to-summary">Summary</button></nav>` : ''}
      ${view === 'stage' ? `<button type="button" class="bar-locator" id="open-map-bar" aria-label="Open the comp">${compLayer({ x: 0, y: 0, w: 1, h: 1 })}</button>` : ''}
    </header>`;
  }
  function banner() {
    if (options.status) return `<div class="banner stale" role="alert">${ICON.alert}<div><strong>This review is out of date.</strong><p>${esc(staleDetail(options.status))} Ask the agent to prepare a new round, then reload this page.</p></div><button id="reload" class="ks-button ks-button-secondary">Reload</button></div>`;
    if (error) return `<div class="banner error" role="alert">${ICON.alert}<div><strong>Your decisions were not sent.</strong><p>${esc(error)}</p></div><button id="retry" class="ks-button ks-button-secondary">Try again</button></div>`;
    return '';
  }

  function intro() {
    const round2 = !!history && packet.round > 1;
    return `<div class="intro ${enter ? `enter-${enter}` : ''}">
      <div class="intro-copy">
        <p class="eyebrow">${round2 ? `Round ${packet.round}` : 'Before any page code'}</p>
        <h1>${round2 ? 'Check what changed.' : 'Review the plan and assets.'}</h1>
        <p class="lead">${esc(introLine(packet, draft, history))}</p>
        <dl class="kinds-explained">
          <div><dt><i class="swatch asset"></i>A generated image</dt><dd>Does it match the comp?</dd></div>
          <div><dt><i class="swatch plan"></i>A region drawn in code</dt><dd>Can code do it justice, or should it be an image?</dd></div>
        </dl>
        <button type="button" class="ks-button ks-button-primary" id="start">Start${kbd('↵')}${ksArrow}</button>
      </div>
      <figure class="intro-comp"><div class="map" style="aspect-ratio:${packet.comp.width}/${packet.comp.height}"><img class="comp" src="${url(packet.comp.url)}" alt="The approved comp" draggable="false">${regionsOverlay({ code: false, interactive: false })}</div></figure>
    </div>`;
  }

  function stageFigures(c: PlanItem) {
    const prior = priorRound(c.id, history);
    const ratio = boxRatio(c.box);
    const natural = `${c.box.w * packet.comp.width}x${c.box.h * packet.comp.height}`;
    if (c.role === 'asset' && c.preview.url) {
      const src = c.preview.url;
      const clear = isTransparent(c, src);
      const bd = backdrop[c.id] ?? 'comp';
      const switchMarkup = clear ? `<button type="button" class="ks-switch backdrop-switch" id="backdrop" aria-pressed="${bd !== 'comp'}" title="Backdrop behind the transparent image"><span class="ks-switch-track" aria-hidden="true"><span class="ks-switch-knob"></span></span><span class="ks-switch-label">${bd === 'comp' ? 'On comp colour' : bd === 'light' ? 'On light' : 'On dark'}</span></button>` : '';
      const gen = `<figure class="fig" data-role="generated"><figcaption><span class="eyebrow">${flipped ? 'In the comp' : prior?.beforeUrl ? 'After' : 'Generated'}</span>${switchMarkup}</figcaption><div class="frame ${flipped ? 'flipped' : ''}">${genLayer(c, src)}${compLayer(c.box, 'flip')}</div></figure>`;
      const comp = `<figure class="fig"><figcaption><span class="eyebrow">In the comp</span></figcaption><div class="frame">${compLayer(c.box)}</div></figure>`;
      if (prior?.beforeUrl) {
        const before = `<figure class="fig"><figcaption><span class="eyebrow">Before · round ${prior.round}</span></figcaption><div class="frame">${genLayer(c, prior.beforeUrl, 'gen before')}</div></figure>`;
        return `<div class="figures" data-ratios="${ratio},${ratio},${ratio}" data-natural="${natural}">${before}${gen}${comp}</div>`;
      }
      return `<div class="figures" data-ratios="${ratio},${ratio}" data-natural="${natural}">${comp}${gen}</div>`;
    }
    if (c.role === 'asset') return `<div class="figures empty"><p>This image has no generated file.</p></div>`;
    return `<div class="figures single" data-box="${esc(JSON.stringify(c.box))}"><figure class="fig"><figcaption><span class="eyebrow">In the comp</span></figcaption><div class="frame">${compLayer(c.box)}<span class="focus-box"></span></div></figure></div>`;
  }

  function decisionBar(c: PlanItem) {
    if (submitted) return `<div class="decide-bar"><p class="record">${esc(stateWord(c))}${currentDecision(c, draft)?.feedback ? `: “${esc(currentDecision(c, draft)!.feedback)}”` : '.'}</p></div>`;
    if (form && !form.region) {
      const reclass = form.type === 'reclassify';
      const planChange = !reclass && c.role === 'plan';
      return `<form class="decide-bar form" id="decision-form">
        ${reclass ? `<div class="form-row"><span class="eyebrow" id="kinds-label">Make it</span><div class="ks-instrument-strip is-paper" data-ks-strip="kind" role="group" aria-labelledby="kinds-label">${ASSET_KINDS.map(k => `<button type="button" class="ks-instrument-key" data-kind="${k.kind}" aria-pressed="${form!.kind === k.kind}">${k.label}</button>`).join('')}</div></div>` : ''}
        <label class="field"><span class="eyebrow">${reclass ? 'Anything the image should keep? Optional' : planChange ? 'What should change?' : 'What needs to change? Optional'}</span><textarea id="form-text" rows="2" placeholder="${reclass ? 'For example: keep the brushed direction horizontal.' : planChange ? 'For example: extend the hero photo under the nav.' : 'For example: the figure should face the sea.'}">${esc(form.text)}</textarea></label>
        <div class="form-actions"><button type="button" id="form-cancel" class="ks-button ks-button-ghost">Cancel${kbd('Esc')}</button><button type="submit" class="ks-button ks-button-primary">${reclass ? 'Make it an image' : 'Save note'}${kbd('⌘↵')}</button></div>
      </form>`;
    }
    const d = currentDecision(c, draft);
    const asset = c.role === 'asset';
    return `<div class="decide-bar">
      ${d ? `<p class="current-decision">${d.action === 'approve' ? ICON.check : ''}<span>${esc(stateWord(c))}${d.feedback ? `: “${esc(d.feedback)}”` : '.'}</span><button type="button" class="text-action" id="decision-clear">Clear</button></p>` : ''}
      <div class="decisions">
        <button type="button" id="decide-yes" class="ks-button ks-button-primary">${asset ? 'Looks good' : 'Code is fine'}${kbd('A')}</button>
        <button type="button" id="decide-no" class="ks-button ks-button-secondary">${asset ? 'Needs work' : 'Make it an image'}${kbd('N')}</button>
        ${asset ? '' : `<button type="button" id="decide-other" class="ks-button ks-button-ghost">Something else…${kbd('F')}</button>`}
      </div>
    </div>`;
  }

  function stage() {
    const c = item(current);
    if (!c) return '<div class="stage"><p>Nothing to review.</p></div>';
    const index = queue.findIndex(q => q.id === c.id) + 1;
    const prior = priorRound(c.id, history);
    const flags = c.role === 'plan' ? [...(c.flags ?? []).map(flagMessage), ...(c.codeDrawn ? ['The plan draws this artwork in code.'] : [])] : [];
    const note = (c.note ?? '').trim();
    const sentence = c.role === 'plan'
      ? `<p class="sentence"><strong>Will be drawn in code:</strong> ${esc(note || planStatement(c).toLowerCase())}</p>`
      : prior?.wasCode ? `<p class="sentence"><s>Was going to be drawn in code: ${esc(prior.wasNote)}</s> Now a generated ${esc(KIND_WORD[c.kind] ?? c.kind)}.</p>`
      : note ? `<p class="sentence muted">${esc(note)}</p>` : '';
    return `<div class="stage ${c.role === 'plan' ? 'is-single' : ''} ${enter ? `enter-${enter}` : ''}">
      <div class="stage-head">
        <p class="eyebrow">${c.role === 'asset' ? `Generated ${esc(KIND_WORD[c.kind] ?? c.kind)}` : `Drawn in code · ${esc(c.kind)}`} · ${index} of ${queue.length}</p>
        <h1>${esc(c.name)}</h1>
        ${prior?.words ? `<blockquote class="asked"><span class="eyebrow">You asked in round ${prior.round}</span><p>“${esc(prior.words)}”</p></blockquote>` : ''}
      </div>
      ${stageFigures(c)}
      <div class="stage-foot">
        ${sentence}
        ${flags.map(f => `<p class="flag">${esc(f)}</p>`).join('')}
        ${c.role === 'asset' && !hintSeen && !submitted ? `<p class="hint">Hold ${kbd('Space')} to flip to the comp. Hover to magnify both.</p>` : ''}
      </div>
      <button type="button" class="locator" id="open-map" aria-label="Open the comp"><span class="locator-map" style="aspect-ratio:${packet.comp.width}/${packet.comp.height}"><img src="${url(packet.comp.url)}" alt="" draggable="false"><span class="locator-box" style="${boxStyle(c.box)}"></span></span><span class="locator-label">Comp ${kbd('C')}</span></button>
    </div>
    ${decisionBar(c)}`;
  }

  function sidePanel(): string {
    if (panel?.type === 'missing') {
      const m = draft.missing.find(x => x.id === panel!.id);
      if (!m) return '';
      return `<div class="side-panel"><p class="eyebrow missing">Missing from the review</p>
        <label class="field"><span class="eyebrow">Name</span><input id="missing-name" value="${esc(m.name)}" placeholder="For example: harbour boat" ${locked() ? 'disabled' : ''}></label>
        <label class="field"><span class="eyebrow">What is missing? Optional</span><textarea id="missing-feedback" rows="2" ${locked() ? 'disabled' : ''}>${esc(m.feedback)}</textarea></label>
        <div class="form-actions start"><button type="button" id="panel-done" class="ks-button ks-button-secondary">Done</button>${locked() ? '' : '<button type="button" id="missing-remove" class="ks-button ks-button-ghost">Remove</button>'}</div></div>`;
    }
    if (panel?.type === 'region') {
      const r = region(panel.id);
      if (!r) return '';
      const re = regionReclassify(draft, r.id);
      const formHere = form?.region && form.id === r.id;
      return `<div class="side-panel"><p class="eyebrow">Set in code · ${esc(r.kind)}</p><h3>${esc(r.name)}</h3>
        <div class="panel-crop" style="aspect-ratio:${Math.max(.5, Math.min(6, boxRatio(r.box)))}">${compLayer(r.box)}</div>
        ${formHere ? `<form id="decision-form" class="panel-form"><div class="ks-instrument-strip is-paper" data-ks-strip="region-kind" role="group" aria-label="Make it">${ASSET_KINDS.map(k => `<button type="button" class="ks-instrument-key" data-kind="${k.kind}" aria-pressed="${form!.kind === k.kind}">${KIND_WORD[k.kind][0].toUpperCase() + KIND_WORD[k.kind].slice(1)}</button>`).join('')}</div><textarea id="form-text" rows="2" placeholder="Anything the image should keep? Optional">${esc(form!.text)}</textarea><div class="form-actions start"><button type="submit" class="ks-button ks-button-primary">Make it an image</button><button type="button" id="form-cancel" class="ks-button ks-button-ghost">Cancel</button></div></form>`
          : re ? `<p class="current-decision"><span>Becomes ${esc(KIND_WORD[re.kind])}${re.feedback ? `: “${esc(re.feedback)}”` : '.'}</span>${locked() ? '' : '<button type="button" class="text-action" id="region-keep">Keep in code</button>'}</p>`
          : `<p class="muted">Checked in the first-viewport review, once the page is built.</p><div class="form-actions start">${locked() ? '' : `<button type="button" class="ks-button ks-button-secondary" id="region-image">Make it an image</button>`}<button type="button" id="panel-done" class="ks-button ks-button-ghost">Close</button></div>`}
      </div>`;
    }
    return `<div class="side-panel quiet"><p>Every outlined region above was on your list. Hover the comp to see what is set in code; click a region to make it an image.</p>${locked() ? '' : `<button type="button" class="ks-button ks-button-secondary" id="mark" aria-pressed="${marking}">${marking ? 'Cancel marking' : 'Mark missing'}</button>`}${marking ? '<p class="marking-hint">Drag on the comp around what is missing.</p>' : ''}${draft.missing.length ? `<ul class="missing-list">${draft.missing.map(m => `<li><button type="button" class="text-action" data-missing="${esc(m.id)}">${esc(m.name || 'Unnamed missing piece')}</button></li>`).join('')}</ul>` : ''}</div>`;
  }

  function summary() {
    const s = planSummary(packet, draft);
    const helper = options.status ? 'This round can no longer be sent.'
      : s.pending && !s.hasChanges ? `${s.pending} still to decide.`
      : s.mode === 'approve' ? 'Approval confirms nothing is missing from the comp.'
      : `${s.pending ? `${s.pending} undecided stay open. ` : ''}The agent applies your notes and opens a new round.`;
    const card = (c: PlanItem) => {
      const d = currentDecision(c, draft);
      const st = itemState(c, draft);
      let pic: string;
      if (c.role === 'asset' && c.preview.url) {
        const r = boxRatio(c.box);
        pic = `<span class="card-pic" style="aspect-ratio:${r};width:min(100%, ${Math.round(118 * r)}px)">${genLayer(c, c.preview.url)}</span>`;
      } else {
        // A plan item's thumb is the same tight crop as its stage, sized to the card.
        const fit = planView(c.box, packet.comp.width, packet.comp.height, 220, 118);
        const v = fit.view;
        pic = `<span class="card-pic" style="width:${Math.floor(fit.width)}px;height:${Math.floor(fit.height)}px"><span class="pic crop"><img src="${url(packet.comp.url)}" alt="" draggable="false" style="width:${100 / v.w}%;left:${-100 * v.x / v.w}%;top:${-100 * v.y / v.h}%"></span><span class="focus-box" style="${boxStyle({ x: (c.box.x - v.x) / v.w, y: (c.box.y - v.y) / v.h, w: c.box.w / v.w, h: c.box.h / v.h })}"></span></span>`;
      }
      return `<button type="button" class="card ${st}" data-go="${esc(c.id)}"><span class="card-thumb">${pic}</span><span class="card-text"><span class="card-name">${esc(c.name)}</span><span class="card-state">${st === 'approved' ? ICON.check : ''}${esc(stateWord(c))}</span>${d?.feedback ? `<span class="card-note">“${esc(d.feedback)}”</span>` : ''}</span></button>`;
    };
    return `<div class="summary ${enter ? `enter-${enter}` : ''}">
      <div class="summary-head">
        <p class="eyebrow">${submitted ? `Round ${packet.round} · sent` : 'Summary'}</p>
        <h1>${submitted ? (s.hasChanges ? 'Notes sent.' : 'Plan and assets approved.') : s.pending ? 'Almost there.' : 'Your decisions.'}</h1>
        ${submitted ? `<p class="lead">${s.hasChanges ? 'The agent applies them and opens a new round for anything that changed.' : 'The agent continues to the first viewport.'}${justSent ? '' : ' This round is read-only.'}</p>` : ''}
      </div>
      <div class="sheet">${queue.map(card).join('')}</div>
      <section class="coverage" aria-label="Coverage">
        <h2>Anything on the comp we didn't cover?</h2>
        <div class="coverage-grid">
          <div class="map-space"><div class="map ${marking ? 'marking' : ''} ${panel ? 'has-selection' : ''}" id="summary-map" style="aspect-ratio:${packet.comp.width}/${packet.comp.height}"><img class="comp" src="${url(packet.comp.url)}" alt="The approved comp" draggable="false">${regionsOverlay({ code: true, interactive: true })}<div class="draw-box" hidden></div></div></div>
          ${sidePanel()}
        </div>
      </section>
    </div>
    ${submitted ? '' : `<div class="send-row"><div class="send-inner"><p>${esc(helper)}</p><button type="button" class="ks-button ks-button-primary" id="send" ${!s.canSubmit || !!form || sending || !!options.status ? 'disabled' : ''}>${sending ? 'Sending…' : esc(sendLabel(packet, draft))}${sending ? '' : ksArrow}</button></div></div>`}`;
  }

  function mapOverlay() {
    if (!mapOpen) return '';
    return `<div class="overlay" role="dialog" aria-modal="true" aria-label="The comp"><div class="overlay-head"><span class="eyebrow">The comp · click a region to go to it</span><button type="button" class="ks-button ks-button-ghost" id="close-map">Close${kbd('Esc')}</button></div>
      <div class="overlay-body"><div class="map has-selection" id="overlay-map" style="aspect-ratio:${packet.comp.width}/${packet.comp.height}"><img class="comp" src="${url(packet.comp.url)}" alt="The approved comp" draggable="false">${regionsOverlay({ code: true, interactive: true })}</div></div></div>`;
  }

  function render() {
    resize?.disconnect(); strips?.();
    const active = root.activeElement as HTMLElement | null;
    const focusId = active?.id;
    const scrollTop = view === 'summary' ? root.querySelector('.view-summary .screen')?.scrollTop ?? 0 : 0;
    root.innerHTML = `<style>${planStyles}</style><section class="rv view-${view} ${submitted ? 'is-submitted' : ''}" aria-label="Plan and asset review">
      ${topBar()}${banner()}
      <main class="screen">${view === 'intro' ? intro() : view === 'stage' ? stage() : summary()}</main>
      ${toast ? `<div class="toast" role="status"><span>${esc(toast.label)}</span><button type="button" class="text-action" id="undo">Undo${kbd('⌘Z')}</button></div>` : ''}
      ${mapOverlay()}
    </section>`;
    enter = null;
    const scr = root.querySelector('.screen'); if (scr && scrollTop) scr.scrollTop = scrollTop;
    if (focusId) root.getElementById(focusId)?.focus({ preventScroll: true });
    wire();
    layout();
    resize = new ResizeObserver(layout); resize.observe(root.querySelector('.screen')!);
    strips = initInstrumentStrips(root);
    if (!submitted) options.onDraftChange?.(structuredClone(draft));
  }

  function layout() {
    const narrow = matchMedia('(max-width: 760px)').matches;
    const figs = root.querySelector<HTMLElement>('.figures[data-ratios]');
    if (figs && figs.clientWidth) {
      const ratios = figs.dataset.ratios!.split(',').map(Number);
      const [nw, nh] = (figs.dataset.natural ?? '0x0').split('x').map(Number);
      const fit = narrow
        ? { direction: 'column' as const, sizes: ratios.map(r => ({ w: Math.min(figs.clientWidth, 360 * r), h: Math.min(figs.clientWidth, 360 * r) / r })) }
        : figureLayout(ratios, figs.clientWidth, figs.clientHeight, 28, 30, 4, { w: nw, h: nh });
      figs.dataset.direction = fit.direction;
      figs.querySelectorAll<HTMLElement>(':scope > .fig > .frame').forEach((f, i) => { f.style.width = `${Math.floor(fit.sizes[i].w)}px`; f.style.height = `${Math.floor(fit.sizes[i].h)}px`; });
      buildLenses(figs);
    }
    const single = root.querySelector<HTMLElement>('.figures.single');
    if (single?.clientWidth) {
      const box = JSON.parse(single.dataset.box!) as Box;
      const stageEl = single.closest<HTMLElement>('.stage')!;
      const spare = stageEl.clientHeight - 36 - 28 - (stageEl.querySelector<HTMLElement>('.stage-head')?.offsetHeight ?? 0) - (stageEl.querySelector<HTMLElement>('.stage-foot')?.offsetHeight ?? 0) - 30 - 80;
      const fit = planView(box, packet.comp.width, packet.comp.height, Math.min(single.clientWidth, 1120), narrow ? 320 : Math.max(80, spare));
      const frame = single.querySelector<HTMLElement>('.frame')!, img = frame.querySelector<HTMLElement>('img')!, focus = frame.querySelector<HTMLElement>('.focus-box')!;
      const v = fit.view;
      frame.style.width = `${Math.floor(fit.width)}px`; frame.style.height = `${Math.floor(fit.height)}px`;
      img.style.cssText = `width:${100 / v.w}%;left:${-100 * v.x / v.w}%;top:${-100 * v.y / v.h}%`;
      focus.style.cssText = boxStyle({ x: (box.x - v.x) / v.w, y: (box.y - v.y) / v.h, w: box.w / v.w, h: box.h / v.h });
      buildLenses(single);
    }
    for (const map of root.querySelectorAll<HTMLElement>('.overlay-body .map, .intro-comp .map')) {
      const space = map.parentElement!;
      const cs = getComputedStyle(space);
      const w = space.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), h = space.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      if (!w || !h) continue;
      const scale = Math.min(w / packet.comp.width, h / packet.comp.height);
      map.style.width = `${packet.comp.width * scale}px`; map.style.height = `${packet.comp.height * scale}px`;
    }
  }

  // Loupe: a lens in each frame shows the same relative spot, magnified.
  const LENS = 78, ZOOM = 3;
  function buildLenses(scope: HTMLElement) {
    scope.querySelectorAll<HTMLElement>('.frame').forEach(frame => {
      frame.querySelector('.lens')?.remove();
      const lens = document.createElement('span');
      lens.className = 'lens'; lens.setAttribute('aria-hidden', 'true');
      const inner = document.createElement('span');
      inner.className = 'lens-inner';
      inner.style.width = `${frame.clientWidth}px`; inner.style.height = `${frame.clientHeight}px`;
      frame.querySelectorAll(':scope > .pic, :scope > .focus-box').forEach(p => inner.append(p.cloneNode(true)));
      lens.append(inner);
      frame.append(lens);
    });
  }
  function moveLens(fx: number, fy: number) {
    root.querySelectorAll<HTMLElement>('.figures .frame').forEach(frame => {
      const lens = frame.querySelector<HTMLElement>('.lens'), inner = lens?.querySelector<HTMLElement>('.lens-inner');
      if (!lens || !inner) return;
      const w = frame.clientWidth, h = frame.clientHeight;
      lens.style.transform = `translate(${fx * w - LENS}px, ${fy * h - LENS}px)`;
      const o = loupeOffset(fx, fy, w, h, LENS, ZOOM);
      inner.style.transform = `translate(${o.x}px, ${o.y}px) scale(${ZOOM})`;
    });
  }

  function wire() {
    const on = (id: string, fn: () => void) => root.getElementById(id)?.addEventListener('click', fn);
    on('start', () => { const first = queue.find(c => itemState(c, draft) === 'pending') ?? queue[0]; if (first) go('stage', first.id, 'next'); else go('summary'); });
    root.querySelectorAll<HTMLElement>('[data-go]').forEach(el => el.addEventListener('click', () => {
      const id = el.dataset.go!; const at = queue.findIndex(c => c.id === current);
      go('stage', id, view !== 'stage' ? 'fade' : queue.findIndex(c => c.id === id) >= at ? 'next' : 'prev');
    }));
    on('to-summary', () => go('summary', undefined, 'next'));
    on('decide-yes', approve);
    on('decide-no', () => openForm(item(current)?.role === 'asset' ? 'revise' : 'reclassify'));
    on('decide-other', () => openForm('revise'));
    on('decision-clear', () => { const c = item(current); if (c && !locked()) { commit(clearDecision(draft, c.id), `Cleared: ${c.name}.`); render(); } });
    on('form-cancel', () => { form = null; render(); });
    root.getElementById('decision-form')?.addEventListener('submit', e => { e.preventDefault(); saveForm(); });
    root.getElementById('form-text')?.addEventListener('input', e => { if (form) form.text = (e.target as HTMLTextAreaElement).value; });
    root.querySelectorAll<HTMLElement>('[data-kind]').forEach(el => el.addEventListener('click', () => {
      if (!form) return;
      form.kind = el.dataset.kind as AssetKind;
      root.querySelectorAll<HTMLElement>('[data-kind]').forEach(k => k.setAttribute('aria-pressed', String(k === el)));
    }));
    on('backdrop', () => { const c = item(current); if (!c) return; const order = ['comp', 'light', 'dark'] as const; backdrop[c.id] = order[(order.indexOf(backdrop[c.id] ?? 'comp') + 1) % 3]; render(); });
    on('undo', undo);
    on('send', () => void send());
    on('retry', () => void send());
    on('reload', () => location.reload());
    const openMap = () => { mapOpen = true; render(); root.getElementById('close-map')?.focus(); };
    on('open-map', openMap);
    on('open-map-bar', openMap);
    on('close-map', () => { mapOpen = false; render(); });
    on('mark', () => { if (locked()) return; marking = !marking; panel = null; form = null; render(); });
    on('panel-done', () => { panel = null; form = null; render(); });
    on('region-image', () => { if (panel?.type === 'region') openForm('reclassify', panel.id); });
    on('region-keep', () => { const r = panel?.type === 'region' ? region(panel.id) : undefined; if (r && !locked()) { commit(setRegionReclassify(draft, r.id, null), `${r.name} stays in code.`); render(); } });
    on('missing-remove', () => { if (panel?.type !== 'missing') return; const id = panel.id; draft = { ...draft, missing: draft.missing.filter(x => x.id !== id) }; panel = null; render(); });
    root.getElementById('missing-name')?.addEventListener('input', e => { const m = draft.missing.find(x => x.id === panel?.id); if (m) { m.name = (e.target as HTMLInputElement).value; const b = root.getElementById('send') as HTMLButtonElement | null; if (b) b.disabled = !planSummary(packet, draft).canSubmit || sending || !!options.status; options.onDraftChange?.(structuredClone(draft)); } });
    root.getElementById('missing-feedback')?.addEventListener('input', e => { const m = draft.missing.find(x => x.id === panel?.id); if (m) { m.feedback = (e.target as HTMLTextAreaElement).value; options.onDraftChange?.(structuredClone(draft)); } });
    if (locked()) root.querySelectorAll<HTMLButtonElement>('#decide-yes,#decide-no,#decide-other,#decision-clear,#mark,#region-image').forEach(b => b.disabled = true);

    // Regions on a map: items open their stage, code regions and missing marks open the side panel.
    root.querySelectorAll<HTMLElement>('.map [data-item]').forEach(el => el.addEventListener('click', () => { if (!marking) go('stage', el.dataset.item!, 'fade'); }));
    const toPanel = (next: NonNullable<typeof panel>) => { if (marking) return; panel = next; form = null; if (view !== 'summary') { view = 'summary'; mapOpen = false; enter = reduced() ? null : 'fade'; } render(); root.querySelector('.coverage')?.scrollIntoView({ block: 'start' }); };
    root.querySelectorAll<HTMLElement>('[data-region]').forEach(el => el.addEventListener('click', () => toPanel({ type: 'region', id: el.dataset.region! })));
    root.querySelectorAll<HTMLElement>('[data-missing]').forEach(el => el.addEventListener('click', () => toPanel({ type: 'missing', id: el.dataset.missing! })));

    // Loupe on the stage.
    const figs = root.querySelector<HTMLElement>('.figures');
    figs?.querySelectorAll<HTMLElement>(':scope > .fig > .frame').forEach(frame => {
      frame.addEventListener('pointerenter', e => { if ((e as PointerEvent).pointerType === 'mouse') figs.classList.add('looking'); });
      frame.addEventListener('pointerleave', () => figs.classList.remove('looking'));
      frame.addEventListener('pointermove', e => { const r = frame.getBoundingClientRect(); moveLens((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); });
    });

    // Drawing a missing mark on the summary map.
    const map = root.getElementById('summary-map');
    if (map) {
      const point = (e: PointerEvent) => { const r = map.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }; };
      let start: { x: number; y: number } | null = null, box: Box | null = null;
      map.addEventListener('pointerdown', e => { if (!marking) return; start = point(e); box = null; map.setPointerCapture(e.pointerId); e.preventDefault(); });
      map.addEventListener('pointermove', e => {
        if (!start) return;
        const p = point(e);
        box = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
        const outline = root.querySelector<HTMLElement>('.draw-box')!; outline.hidden = false; outline.style.cssText = boxStyle(box);
      });
      map.addEventListener('pointerup', () => { if (box && box.w > .01 && box.h > .01) addMissing(box); start = null; box = null; });
      map.addEventListener('pointercancel', () => { start = null; box = null; render(); });
    }
  }

  function setFlip(on: boolean) {
    if (flipped === on) return;
    flipped = on;
    root.querySelectorAll<HTMLElement>('[data-role="generated"] .frame').forEach(f => f.classList.toggle('flipped', on));
    const cap = root.querySelector<HTMLElement>('[data-role="generated"] figcaption .eyebrow');
    if (cap) cap.textContent = on ? 'In the comp' : priorRound(current ?? '', history)?.beforeUrl ? 'After' : 'Generated';
    if (on && !hintSeen) { hintSeen = true; storage.set('impeccable.review.flipHint', '1'); root.querySelector('.hint')?.classList.add('gone'); }
  }

  const onKey = (event: Event) => {
    const e = event as KeyboardEvent;
    if (!host.isConnected || e.defaultPrevented) return;
    const target = e.composedPath()[0] as HTMLElement;
    const typing = target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
    if (e.key === 'Escape') {
      if (mapOpen) { e.preventDefault(); mapOpen = false; render(); }
      else if (form) { e.preventDefault(); form = null; render(); }
      else if (marking) { e.preventDefault(); marking = false; render(); }
      else if (panel) { e.preventDefault(); panel = null; render(); }
      return;
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && form) { e.preventDefault(); saveForm(); return; }
    if (typing || e.altKey || e.isComposing) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { if (toast) { e.preventDefault(); undo(); } return; }
    if (e.metaKey || e.ctrlKey) return;
    if (view === 'intro' && e.key === 'Enter' && target?.tagName !== 'BUTTON') { e.preventDefault(); root.getElementById('start')?.click(); return; }
    if (mapOpen || form) return;
    const key = e.key.toLowerCase();
    if (e.key === ' ' && view === 'stage' && item(current)?.role === 'asset' && target?.tagName !== 'BUTTON' && target?.tagName !== 'A') { e.preventDefault(); if (!e.repeat) setFlip(true); return; }
    if (e.key === ' ' && view === 'stage' && item(current)?.role === 'asset') { e.preventDefault(); if (!e.repeat) setFlip(true); return; }
    if (key === 'c' && view !== 'intro') { e.preventDefault(); mapOpen = true; render(); return; }
    if (view !== 'stage' || locked()) {
      if (view === 'summary' && (key === 'k' || e.key === 'ArrowLeft') && queue.length && !locked()) { e.preventDefault(); go('stage', queue[queue.length - 1].id, 'prev'); }
      return;
    }
    if (key === 'a') { e.preventDefault(); approve(); }
    else if (key === 'n') { e.preventDefault(); root.getElementById('decide-no')?.click(); }
    else if (key === 'f' && item(current)?.role === 'plan') { e.preventDefault(); openForm('revise'); }
    else if (key === 'j' || e.key === 'ArrowRight') { e.preventDefault(); move(1); }
    else if (key === 'k' || e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
  };
  const onKeyUp = (event: Event) => { if ((event as KeyboardEvent).key === ' ' && flipped) { event.preventDefault(); setFlip(false); } };
  const onBlur = () => setFlip(false);
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  render();
  return {
    destroy() { resize?.disconnect(); strips?.(); document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur); root.replaceChildren(); },
    getDraft(): PlanDraft { return structuredClone(draft); },
  };
}
