/* Design context document, the questionnaire's final act and its own surface.
 *
 * This module is the document's data layer. It reads the finished interview,
 * builds each category's article into the #dcx-detail-* templates, reveals the
 * tile shell, and keeps the live edit session. What it no longer owns is the
 * presentation: the mosaic morph, sidebar, scroll-spy, and section styling are
 * the engine's, in scripts/dcx/, ported from the standalone design context
 * demo. It mounts those same templates as one continuous document.
 *
 * Everything is assembled client-side before the POST resolves, because the
 * server's exit on /submit is the completion signal the agent waits on, and
 * after it there is nothing to fetch.
 *
 * The document is also openable on its own, long after that run. The boot
 * contract says which of the two this page is, and document mode renders from
 * the design-context store with no submit involved.
 */

import { contrastInk, contrastInkHex, formatOklch, readableOn } from './color.js';
import { getBoot, hydrationReady } from './boot.js';
import { loadIconPacks } from './palette-picker.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const form = $('#picker-form');
const shell = $('[data-dcx-shell]');

/* Seed context (the chat half of the interview) lives in the design-context
   store; the dealt palettes stay with the cues that generated them. Both are
   fetched at load, before the server can exit: the context block feeds the
   chat-sourced pages, and the palette map is what the provenance tags compare
   committed values against. Both promises are kept rather than discarded,
   because a document opened directly renders from them instead of waiting on
   a submit that never comes. */
let seedContext = null;
let seedModes = null;
let seedPalettes = null;
let seedCues = null;

const getJson = (url) => fetch(url)
  .then((response) => (response.ok ? response.json() : null))
  .catch(() => null);

const cuesReady = getJson('/cues.json').then((data) => {
  seedPalettes = data?.palette || null;
  seedCues = Array.isArray(data?.cues) ? data.cues : null;
  return data;
});

/* Field by field, not file by file: a store written before a field existed,
   or one carrying only half a run, still falls back to whatever the cue
   manifest kept from the release that wrote it. */
const contextReady = Promise.all([getJson('/context.json'), cuesReady])
  .then(([stored, cues]) => {
    seedContext = stored?.context ?? cues?.context ?? null;
    const modes = Array.isArray(stored?.modes) ? stored.modes : cues?.modes;
    seedModes = Array.isArray(modes) ? modes : null;
  });

/* The winning cue's dealt value for one role, read the way the deck's own
   createState reads it in palette-picker.js: the pixel-snapped value when
   the search landed, the planned hex otherwise, uppercased. A palette
   source that is not a cue in cues.json (a seed-deck card, a custom
   palette) has no entry here and returns nothing, which is what turns the
   provenance tag off. */
/* Which of the two surfaces this page is. Set before the document renders in
   document mode, read by the parts of it that differ. */
let docMode = false;

/* The chosen cue, wherever this page can still reach it. A live doc session
   outlives every server the page booted from, so it is the first choice, and
   the store's copy is made during submit before that session is forked. A
   document opened later without a session still has the picker server serving
   the store copy; a submit run before either exists reads the workspace image
   the questionnaire already displayed, which is in the browser's cache. */
const cueImageSrc = (slug) => {
  if (docSession) return `${docSession.base}/cue.png?token=${encodeURIComponent(docSession.token)}`;
  return docMode ? '/cue.png' : `/cues/${encodeURIComponent(slug)}.png`;
};

const seedHexFor = (source, role) => {
  const slot = seedPalettes?.[source]?.[role];
  if (!slot) return '';
  return String(slot.snapped || slot.hex || '').toUpperCase();
};

/* ============================================================
   Snapshot — everything the document renders, read once.
   ============================================================ */

const ROLES = ['primary', 'secondary', 'tertiary', 'neutral'];
const SURFACE_ORDER = ['persuade', 'operate', 'read', 'experience'];
const SURFACE_LABELS = { persuade: 'Landing page', operate: 'Tool', read: 'Docs', experience: 'Portfolio' };
/* The five questions asked per surface, matching portability.mjs. The bare key
   is the leading surface's answer, which is what DESIGN.md records as the rule
   for the whole product. */
const PER_SURFACE = ['color-strategy', 'boundary-style', 'corner-style', 'depth-style', 'motion-energy'];

const fieldValue = (name) => {
  const field = form.elements[name];
  return field && typeof field.value === 'string' ? field.value : '';
};

/* The option copy is already on the page, on the radios the user answered
   with, so the document quotes the screens instead of keeping a second copy
   of every title and description. */
function optionCopy(name, value) {
  const input = form.querySelector(`input[name="${name}"][value="${value}"]`);
  const label = input?.closest('label');
  if (!label) return { title: value, desc: '' };
  const title = label.querySelector('.picker-strategy-title, .picker-icon-title');
  const desc = label.querySelector('.picker-strategy-desc, .picker-icon-meta');
  return {
    title: (title?.textContent || value).replace(/^[\d.]+\s*/, '').trim(),
    desc: (desc?.textContent || '').trim(),
  };
}

function chosenSurfaces() {
  return $$('input[name="surface-modes"]:checked', form)
    .sort((a, b) => SURFACE_ORDER.indexOf(a.value) - SURFACE_ORDER.indexOf(b.value))
    .map((input) => {
      const tile = input.closest('.picker-mode-tile');
      return {
        mode: input.value,
        label: input.dataset.surfaceLabel || input.value,
        goal: tile?.querySelector('.picker-mode-goal')?.textContent.trim() || '',
        examples: $$('.picker-mode-pills i', tile || form).map((pill) => pill.textContent.trim()),
      };
    });
}

/* Per-surface answers: the base key holds the leading surface, and each chosen
   surface has its own hidden field, marked data-chosen when the user actually
   visited it rather than inheriting the default for its kind.

   A question is not always put to every surface, and the field it rendered is
   which: a surface with nowhere to answer was never asked, so it is left out
   rather than shown holding the leading surface's pick. An empty list means the
   run never saw the screen at all. */
function perSurface(name, surfaces) {
  return surfaces.flatMap((surface) => {
    const field = form.querySelector(`input[data-surface-field="${name}-${surface.mode}"]`);
    if (!field) return [];
    const value = field.value || fieldValue(name);
    return [{
      ...surface,
      value,
      chosen: field.dataset.chosen === 'yes',
      ...optionCopy(name, value),
    }];
  });
}

/* A flat question keeps one answer rather than one per surface, and its fields
   are still what says whether it was put at all: none of the chosen surfaces
   holding one means the run never saw the screen. The leading applicable surface
   owns the answer, which is the rule the bare key in answers.json is written by
   too. */
function flatAnswer(name, surfaces) {
  const [leader] = perSurface(name, surfaces);
  return leader ?? { value: '', title: '', desc: '' };
}

function takeSnapshot() {
  const surfaces = chosenSurfaces();
  const palette = ROLES.map((role) => ({
    role: role[0].toUpperCase() + role.slice(1),
    hex: fieldValue(`palette-${role}`).toUpperCase(),
  })).filter((entry) => entry.hex);

  const scaleInput = form.querySelector('input[name="type-scale"]:checked');
  const pairCard = form.querySelector('input[name="font-pair"]:checked')?.closest('.picker-type-option');

  return {
    context: seedContext,
    suggestedModes: seedModes,
    cueSlugs: seedCues,
    surfaces,
    palette,
    paletteSource: fieldValue('palette-source'),
    strategy: perSurface('color-strategy', surfaces),
    boundaries: perSurface('boundary-style', surfaces),
    corners: perSurface('corner-style', surfaces),
    depth: perSurface('depth-style', surfaces),
    motion: perSurface('motion-energy', surfaces),
    layout: flatAnswer('layout-structure', surfaces),
    fonts: {
      heading: fieldValue('font-heading'),
      body: fieldValue('font-body'),
      headingSource: fieldValue('font-heading-source'),
      bodySource: fieldValue('font-body-source'),
      why: pairCard?.querySelector('[data-pair-why]')?.textContent.trim() || '',
    },
    scale: {
      name: scaleInput?.dataset.scaleName || '',
      ratio: Number(fieldValue('type-scale-ratio') || scaleInput?.dataset.ratio || 0),
      desc: scaleInput ? optionCopy('type-scale', scaleInput.value).desc : '',
    },
    icons: {
      pack: fieldValue('icon-pack-name'),
      license: fieldValue('icon-pack-license'),
      url: fieldValue('icon-pack-url'),
    },
  };
}

/* ============================================================
   Article builders — the prototype's block vocabulary, filled
   from the snapshot. Every builder returns innerHTML for one
   dcx-detail template.
   ============================================================ */

/* A stored value the schema asks for as a bare action arrives as a fragment
   ("walk over"), and the callout slot beside it holds sentences. Lift the
   first letter only, and only when the first word is otherwise lowercase, so
   a deliberate lowercase token (iPhone, npm) is left alone. Applied at ONE
   call site (Primary conversion); the other value slots are fed by templates
   that already ask for sentences, and several hold identifiers. */
const sentenceCase = (value) => {
  const text = String(value);
  const first = text.split(/\s/)[0] || '';
  if (!/^[a-z]/.test(text) || /[A-Z]/.test(first)) return text;
  return text[0].toUpperCase() + text.slice(1);
};

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

const heading = (index, title, lede, productName) => `
  <header>
    <span class="dcx-eyebrow">Design context &middot; 0${index} / 08${productName ? ` &middot; ${escapeHtml(productName)}` : ''}</span>
    <h2 class="dcx-title">${escapeHtml(title)}</h2>
    <p class="dcx-lede">${escapeHtml(lede)}</p>
  </header>`;

const block = (label, inner) => `
  <div class="dcx-block" data-label="${escapeHtml(label)}">
    <span class="dcx-block-label">${escapeHtml(label)}</span>
    ${inner}
  </div>`;

const defs = (items) => `
  <dl class="dcx-defs">${items.map(({ dt, dd }) => `
    <div class="dcx-def"><dt>${dt}</dt><dd>${dd}</dd></div>`).join('')}
  </dl>`;

const callout = (name, body, accent = false, extra = '') => `
  <div class="dcx-callout${accent ? ' dcx-callout--accent' : ''}">
    <p class="dcx-callout-name">${escapeHtml(name)}</p>
    <p>${body}</p>${extra}
  </div>`;

const list = (items) => `
  <ul class="dcx-list">${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;

const principlesList = (items) => `
  <ol class="dcx-principles">${items.map((item) => {
    if (item && typeof item === 'object' && item.title) {
      return `<li><strong>${escapeHtml(item.title)}</strong>${item.detail ? ` &mdash; ${escapeHtml(item.detail)}` : ''}</li>`;
    }
    return `<li>${escapeHtml(item)}</li>`;
  }).join('')}</ol>`;

const chips = (items) => `
  <div class="dcx-chips">${items.map((item) => `<span class="dcx-chip dcx-chip--muted">${escapeHtml(item)}</span>`).join('')}</div>`;

const empty = (title, body) => `
  <div class="dcx-empty">
    <p class="dcx-empty-title">${escapeHtml(title)}</p>
    <p>${body}</p>
  </div>`;

const note = (text) => `<p class="dcx-fan-note">${text}</p>`;

/* Chat-round material renders when the agent passed it along, and says where
   it lives when it did not — an interview that skipped a question is a fact
   the document reports, not a gap it papers over. */
const fromChat = (what, home) => empty(
  'Captured in chat',
  `${what} in chat, before the browser questionnaire. ${home} is the durable copy.`,
);

/* Staged brand-asset files are served by the picker server before submit and
   by the doc session after it: the picker process exits when the submit
   response lands, and article images only load when a detail view opens,
   which is always after that. docSession is assigned before any render that
   can reach the live DOM (startDocSession re-renders the templates). */
const brandAssetSrc = (file) => (docSession
  ? `${docSession.base}/brand-assets/${encodeURIComponent(file)}?token=${encodeURIComponent(docSession.token)}`
  : `/brand-assets/${encodeURIComponent(file)}`);

/* Cue and asset images load after their innerHTML render. The load pass
   stamps the cue frame with the image's natural size, which is the space
   the cues.json sample coordinates live in (the same division the picker's
   own ring placement does); the error pass hides the broken entry so a
   missing file never leaves a dead image in an article. Capture phase,
   because load and error do not bubble. */
document.addEventListener('load', (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !('dcxCueImg' in image.dataset)) return;
  const frame = image.closest('.dcx-cue-frame');
  if (!frame) return;
  frame.style.setProperty('--cue-w', String(image.naturalWidth || 1));
  frame.style.setProperty('--cue-h', String(image.naturalHeight || 1));
  frame.dataset.loaded = 'yes';
}, true);

document.addEventListener('error', (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) return;
  /* A card that asked for the cue swaps to its vendored photo rather than
     hiding: the entry is real either way, only the imagery moved. One swap
     only, so a fallback that also fails lands at the hide rule below. */
  if (image.dataset.dcxSwapSrc) {
    const fallback = image.dataset.dcxSwapSrc;
    delete image.dataset.dcxSwapSrc;
    if (image.dataset.dcxSwapAlt) {
      image.alt = image.dataset.dcxSwapAlt;
      delete image.dataset.dcxSwapAlt;
    }
    image.src = fallback;
    return;
  }
  const casualty = image.closest('[data-dcx-hide-on-error]');
  if (casualty) casualty.hidden = true;
}, true);

/* Readable ink for a fan panel, from the swatch's own luminance. */
function inkFor(hex) {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.55 ? 'oklch(20% 0.01 95)' : 'oklch(95% 0.005 95)';
}

/* ============================================================
   Proofs — the questionnaire's own drawings, borrowed.

   The form never leaves the DOM, only the flow: every preview the
   questionnaire painted (mode tiles, strategy artboards, the type
   scale sheet, the icon grid) is still standing behind the document,
   inline variables and all. A detail view that wants to show a
   decision clones the drawing that sold it instead of describing it.
   ============================================================ */

/* The committed palette under the --pkc-* names the strategy remaps read,
   mirroring palette-picker's syncCommittedPalette for nodes that live
   outside the strategy stage. */
function paintCommitted(node) {
  const colors = {};
  for (const role of ROLES) colors[role] = fieldValue(`palette-${role}`);
  if (Object.values(colors).some((hex) => !hex)) return;
  const set = (name, value) => node.style.setProperty(`--pkc-${name}`, value);
  for (const role of ROLES) set(role, colors[role]);
  set('n-ink', contrastInk(colors.neutral));
  set('p-ink', contrastInk(colors.primary));
  set('t-ink', contrastInk(colors.tertiary));
  set('s-on-n', readableOn(colors.secondary, colors.neutral));
  set('p-on-n', readableOn(colors.primary, colors.neutral));
  set('t-on-n', readableOn(colors.tertiary, colors.neutral));
  set('t-on-p', readableOn(colors.tertiary, colors.primary));
  set('p-on-p', readableOn(colors.primary, colors.primary));
  set('t-on-t', readableOn(colors.tertiary, colors.tertiary));
  set('p-on-i', readableOn(colors.primary, contrastInkHex(colors.primary)));
}

/* Component-scale corner and depth ramps for the committed kit. The shadow
   bodies are verbatim from design-context.css's [data-dcx-depth=...] rules;
   the radius values are their component-scale equivalents, because the
   artboard ramp ([data-dcx-corner=...] in the same file) is drawn at
   miniature scale, where 3px reads as a card radius. Change a body here and
   there together. */
const KIT_RADIUS = {
  sharp: { control: '0px', surface: '0px' },
  'slightly-soft': { control: '4px', surface: '6px' },
  friendly: { control: '10px', surface: '14px' },
  pill: { control: '999px', surface: '18px' },
};
const KIT_SHADOW = {
  flat: { card: 'none', control: 'none', surface: 'none' },
  'soft-lift': {
    card: '0 1px 1px rgb(0 0 0 / 0.15), 0 3px 7px rgb(0 0 0 / 0.14)',
    control: '0 1px 2px rgb(0 0 0 / 0.24)',
    surface: '0 2px 5px rgb(0 0 0 / 0.14)',
  },
  floating: {
    card: '0 2px 3px rgb(0 0 0 / 0.2), 0 9px 18px rgb(0 0 0 / 0.24)',
    control: '0 3px 6px rgb(0 0 0 / 0.32)',
    surface: '0 6px 14px rgb(0 0 0 / 0.22)',
  },
};
const KIT_SERIF = /serif|mincho|baskerville|bitter|marcellus|slab|antiqua|garamond|didot|bodoni/i;
const kitStack = (family) => `"${family.replaceAll('"', '\\"')}", ${KIT_SERIF.test(family) ? 'serif' : 'sans-serif'}`;

/* The rest of the committed kit, published the way paintCommitted publishes
   color: onto one node, every value or none. A var() that resolves to nothing
   invalidates its declaration at computed-value time (a missing radius would
   become 0, not the vendored default), so the gate class only goes on when
   fonts, radius, and shadow are all present. Reads the LEADING surface's
   answers (s.corners[0], s.depth[0]): the visible radio follows whichever
   surface tab was shown last, while perSurface() orders by SURFACE_ORDER. */
function paintKit(node, s) {
  const radius = KIT_RADIUS[s.corners[0]?.value];
  const shadow = KIT_SHADOW[s.depth[0]?.value];
  if (!s.fonts.heading || !s.fonts.body || !radius || !shadow) return false;
  const set = (name, value) => node.style.setProperty(`--pkc-${name}`, value);
  set('font-heading', kitStack(s.fonts.heading));
  set('font-body', kitStack(s.fonts.body));
  set('font-heading-weight',
    document.querySelector('input[name="font-pair"]:checked')?.closest('.picker-type-option')
      ?.style.getPropertyValue('--pair-heading-weight') || '400');
  set('radius-control', radius.control);
  set('radius-surface', radius.surface);
  set('shadow-card', shadow.card);
  set('shadow-control', shadow.control);
  set('shadow-surface', shadow.surface);
  if (s.scale.ratio) set('scale-ratio', String(s.scale.ratio));
  return true;
}

/* Clone one questionnaire drawing into a dcx frame. Inline styles travel
   with the clone; ids do not (they would collide with the originals). */
function proofHtml(source, { strategy = '', kind = 'board', marks = null } = {}) {
  if (!source) return '';
  const clone = source.cloneNode(true);
  clone.hidden = false;
  const sourceSurface = source.getAttribute('data-surface') || '';
  clone.removeAttribute('data-surface');
  for (const node of [clone, ...clone.querySelectorAll('[id]')]) node.removeAttribute('id');
  for (const node of $$('button, input', clone)) {
    node.setAttribute('tabindex', '-1');
    node.setAttribute('disabled', '');
  }
  const wrap = document.createElement('div');
  wrap.className = `dcx-proof dcx-proof--${kind}`;
  wrap.setAttribute('aria-hidden', 'true');
  if (strategy) wrap.dataset.dcxStrategy = strategy;
  /* Committed structural answers, restated on the frame. On the screens they
     reach a carried artboard through checked inputs inside #picker-form,
     which a clone in the document is outside of, so design-context.css
     mirrors those bodies against these attributes instead. */
  if (marks) {
    for (const [key, value] of Object.entries(marks)) {
      if (value) wrap.setAttribute(`data-dcx-${key}`, value);
    }
  }
  /* The surface the drawing came from, restated on the frame: the clone loses
     its own data-surface above, and the stylesheet's quiet-base rule has to
     tell a persuade board from a derived one. Marks that already named a
     surface win, since those carry the committed answer. */
  if (sourceSurface && !wrap.hasAttribute('data-dcx-surface')) {
    wrap.setAttribute('data-dcx-surface', sourceSurface);
  }
  paintCommitted(wrap);
  wrap.appendChild(clone);
  return wrap.outerHTML;
}

/* The strategy screen mounts one painted artboard per chosen surface and
   leaves them standing; the tile previews on the surfaces screen never move
   at all. Both are lookups, not rebuilds. */
const surfaceBoard = (mode) => $(`[data-surface-stage] [data-surface="${mode}"]`);
const surfaceTilePreview = (mode) => $(`input[name="surface-modes"][value="${mode}"]`)
  ?.closest('.picker-mode-tile')?.querySelector('.picker-preview');

/* The boundaries screen keeps one carried ps artboard per surface, and by
   that screen the drawing is the page as chosen so far. It is the clone
   source for any proof that wants the whole material story on one page. */
const questionBoard = (question, mode) => $(`[data-question="${question}"] .picker-board-stage > :is(.picker-artboard, .picker-preview)[data-surface="${mode}"]`);
const carriedBoard = (mode) => questionBoard('boundaries', mode);
/* The motion screen boards one drawing per surface AND option; the answer
   names which one is the committed drawing. */
const motionBoard = (mode, value) => $(`[data-question="motion"] .picker-board-stage > :is(.picker-artboard, .picker-preview)[data-motion-cell="${mode}-${value}"]`);

/* One surface's committed structural answers, as the data-dcx-* marks the
   document stylesheet keys its mirrored bodies on. Layout is one answer for
   the whole run, so every surface's frame carries the same value. */
const materialMarks = (s, mode) => ({
  surface: mode,
  boundary: s.boundaries.find((entry) => entry.mode === mode)?.value || '',
  corner: s.corners.find((entry) => entry.mode === mode)?.value || '',
  depth: s.depth.find((entry) => entry.mode === mode)?.value || '',
  layout: s.layout.value || '',
});

/* One line per surface for the per-surface questions, marking whether the
   user configured the surface or it kept the default for its kind. */
const surfaceDefs = (entries) => defs(entries.map((entry) => ({
  dt: escapeHtml(entry.label),
  dd: `<strong>${escapeHtml(entry.title)}</strong> &middot; ${escapeHtml(entry.desc)}${entry.chosen ? '' : ' <em>(default for this surface)</em>'}`,
})));

function buildAudience(s, name) {
  const audience = s.context?.audience || {};
  const parts = [heading(1, 'Audience', 'Who it is for, emotional state, needs, trust triggers.', name)];
  const who = [
    audience.primary && { dt: 'Primary', dd: escapeHtml(audience.primary) },
    audience.secondary && { dt: 'Secondary', dd: escapeHtml(audience.secondary) },
  ].filter(Boolean);
  parts.push(block('Who they are', who.length
    ? defs(who)
    : fromChat('The primary and secondary user read was confirmed', '<code>PRODUCT.md &middot; Users</code>')));
  /* Arrival-only context keeps the old single-callout block; a leaving line
     widens it into the two-beat journey, side by side. */
  if (audience.emotion || audience.leaving) {
    const arrival = audience.emotion ? callout('On arrival', escapeHtml(audience.emotion), true) : '';
    const leaving = audience.leaving ? callout('Leaving with', escapeHtml(audience.leaving), true) : '';
    if (arrival && leaving) {
      parts.push(block('Emotional journey', `<div class="dcx-callout-pair">${arrival}${leaving}</div>`));
    } else {
      parts.push(block(arrival ? 'Emotional state' : 'Emotional journey', arrival || leaving));
    }
  }
  /* Needs and trust triggers share a two-column row when both exist; either
     alone keeps the full measure. The nested blocks keep their data-label,
     which is what the expander subnav is built from. */
  const needsBlock = Array.isArray(audience.needs) && audience.needs.length
    ? block('Needs', list(audience.needs.map(escapeHtml))) : '';
  const trustBlock = Array.isArray(audience.trust) && audience.trust.length
    ? block('Trust triggers', list(audience.trust.map(escapeHtml))) : '';
  if (needsBlock && trustBlock) parts.push(`<div class="dcx-cols">${needsBlock}${trustBlock}</div>`);
  else if (needsBlock || trustBlock) parts.push(needsBlock || trustBlock);
  if (Array.isArray(audience.inclusion) && audience.inclusion.length) {
    parts.push(block('Who must not be excluded', list(audience.inclusion.map(escapeHtml))));
  }
  return parts.join('');
}

/* A surface card in the questionnaire's own anatomy: the tile's dual-artboard
   drawing on top, dressed in the committed palette, then the label and goal
   the tile carried. */
function surfaceCards(s, body) {
  return `<div class="dcx-surfaces" data-count="${s.surfaces.length}">${s.surfaces.map((surface, index) => `
    <article class="dcx-surface-card">
      ${proofHtml(surfaceBoard(surface.mode) || surfaceTilePreview(surface.mode), { kind: 'board' })}
      <div class="dcx-surface-copy">
        <h3 class="dcx-surface-name">${escapeHtml(surface.label)}${index === 0 ? ' <span class="dcx-default-mark">leading</span>' : ''}</h3>
        ${body(surface)}
      </div>
    </article>`).join('')}</div>`;
}

function surfaceProvenanceNote(s) {
  if (!Array.isArray(s.suggestedModes) || !s.suggestedModes.length) return '';
  const chosen = s.surfaces.map((surface) => surface.mode);
  const suggestedSet = new Set(s.suggestedModes);
  const chosenSet = new Set(chosen);
  const label = (mode) => s.surfaces.find((surface) => surface.mode === mode)?.label
    || SURFACE_LABELS[mode]
    || mode;
  const added = chosen.filter((mode) => !suggestedSet.has(mode));
  const removed = s.suggestedModes.filter((mode) => !chosenSet.has(mode));
  let tail = 'you kept the suggested set';
  if (added.length && removed.length) {
    tail = `you added ${added.map(label).join(', ')} and dropped ${removed.map(label).join(', ')}`;
  } else if (added.length) {
    tail = `you added ${added.map(label).join(', ')}`;
  } else if (removed.length) {
    tail = `you dropped ${removed.map(label).join(', ')}`;
  }
  return note(`Suggested from <code>PRODUCT.md</code>: ${s.suggestedModes.map(label).join(', ')}; ${tail}.`);
}

/* Display labels for the PRODUCT.md platform value; an unrecognized value
   renders as written rather than being dropped. */
const PLATFORM_LABELS = { web: 'Web', ios: 'iOS', android: 'Android', adaptive: 'Adaptive' };

function buildProduct(s, name) {
  const product = s.context?.product || {};
  const parts = [heading(2, 'Product', 'Purpose, surfaces, use cases, what must be clear first.', name)];
  const purposeCallout = product.purpose
    ? callout(product.name || name || 'This product', escapeHtml(product.purpose), false,
        product.success ? `\n    <p class="dcx-callout-success">${escapeHtml(product.success)}</p>` : '')
    : fromChat('The purpose and success definition were confirmed', '<code>PRODUCT.md &middot; Product Purpose</code>');
  const platform = typeof product.platform === 'string' && product.platform.trim()
    ? `<span class="dcx-chip dcx-platform-pill">${escapeHtml(PLATFORM_LABELS[product.platform.trim()] || product.platform.trim())}</span>`
    : '';
  parts.push(block('Purpose', platform
    ? `<div class="dcx-purpose"><div class="dcx-purpose-main">${purposeCallout}</div>${platform}</div>`
    : purposeCallout));
  if (product.positioning && (product.positioning.not || product.positioning.this)) {
    const cells = [
      product.positioning.not && callout('Not this', escapeHtml(product.positioning.not)),
      product.positioning.this && callout('This', escapeHtml(product.positioning.this), true),
    ].filter(Boolean).join('');
    parts.push(block('Positioning', `<div class="dcx-callout-pair">${cells}</div>`));
  }
  if (product.conversion) {
    parts.push(block('Primary conversion', callout('The one action', escapeHtml(sentenceCase(product.conversion)), true)));
  }
  if (Array.isArray(product.clarities) && product.clarities.length) {
    parts.push(block('What must be clear first', list(product.clarities.map(escapeHtml))));
  }
  if (Array.isArray(product.principles) && product.principles.length) {
    parts.push(block('Product principles', principlesList(product.principles)));
  }
  if (product.operatingContext) {
    parts.push(block('Operating context', `<p class="dcx-prose">${escapeHtml(product.operatingContext)}</p>`));
  }
  const surfaceMap = product.surfaces && typeof product.surfaces === 'object' ? product.surfaces : {};
  parts.push(block('Surfaces', surfaceCards(s, (surface) => {
    const specific = typeof surfaceMap[surface.mode] === 'string' ? surfaceMap[surface.mode].trim() : '';
    return `
      <p class="dcx-surface-goal">${escapeHtml(specific || surface.goal || '')}</p>
      ${surface.examples.length ? chips(surface.examples) : ''}`;
  })
    + surfaceProvenanceNote(s)
    + note('Chosen on the questionnaire&rsquo;s first screen, drawn in the committed palette; the leading surface owns every bare answer key in the sections that follow.')));
  return parts.join('');
}

function buildBrand(s, name) {
  const brand = s.context?.brand || {};
  const interview = s.context?.interview || {};
  const parts = [heading(3, 'Brand', 'Identity, voice, references, taste boundaries.', name)];
  /* Personality: the confirmed sentence when the agent passed it; the three
     words alone over the pointer to the durable copy when only they arrived;
     the plain pointer otherwise. */
  parts.push(block('Personality', brand.personality
    ? callout(brand.words?.join(' · ') || 'Voice', escapeHtml(brand.personality), true)
    : (Array.isArray(brand.words) && brand.words.length
      ? callout(brand.words.join(' · '), 'Three words, voice, and tone were confirmed in chat, before the browser questionnaire. <code>PRODUCT.md &middot; Brand Personality</code> is the durable copy.', true)
      : fromChat('Three words, voice, and tone were confirmed', '<code>PRODUCT.md &middot; Brand Personality</code>'))));
  /* Voice: say / not wording pairs the agent derived from Brand Personality
     and Brand Commitments at cues-write time. Concrete lines to write with,
     never adjectives, and no interview question stands behind the field.
     Pairs missing either half are dropped rather than rendered lopsided. */
  const voicePairs = (Array.isArray(brand.voice) ? brand.voice : [])
    .filter((pair) => pair && typeof pair === 'object' && pair.say && pair.not);
  if (voicePairs.length) {
    parts.push(block('Voice', `<div class="dcx-voice">${voicePairs.map((pair) => `
      <div class="dcx-voice-pair">
        <div class="dcx-voice-cell dcx-voice-cell--say"><span class="dcx-voice-tag">Say</span><p>${escapeHtml(pair.say)}</p></div>
        <div class="dcx-voice-cell dcx-voice-cell--not"><span class="dcx-voice-tag">Not</span><p>${escapeHtml(pair.not)}</p></div>
      </div>`).join('')}</div>`
      + note('Derived from Brand Personality and Brand Commitments in <code>PRODUCT.md</code>: wording to write with beside wording to refuse.')));
  }
  /* Principles: PRODUCT.md's own list, in the prototype's numbered anatomy,
     folded into two columns. */
  if (Array.isArray(brand.principles) && brand.principles.length) {
    parts.push(block('Principles', `<ol class="dcx-principles dcx-principles--cols">${brand.principles.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ol>`
      + note('From <code>PRODUCT.md</code>&rsquo;s principles section; the durable copy lives there.')));
  }
  if (Array.isArray(brand.commitments) && brand.commitments.length) {
    parts.push(block('Commitments', list(brand.commitments.map(escapeHtml))));
  }
  if (Array.isArray(interview.references) && interview.references.length) {
    /* Q4 references arrive as plain strings from old cues.json files and as
       { name, takeaway } objects from new ones; a mixed list renders each
       entry in its own form. Strings stay the bare pills they were. */
    const cards = interview.references.filter((ref) => ref && typeof ref === 'object' && ref.name);
    const plain = interview.references.filter((ref) => typeof ref === 'string');
    const inner = (cards.length ? `<div class="dcx-ref-cards">${cards.map((ref) => `
      <article class="dcx-ref-card">
        <h3 class="dcx-ref-name">${escapeHtml(ref.name)}</h3>${ref.takeaway ? `
        <p class="dcx-ref-takeaway">${escapeHtml(ref.takeaway)}</p>` : ''}
      </article>`).join('')}</div>` : '') + (plain.length ? chips(plain) : '');
    parts.push(block('Named references', inner
      + note('Q4 of the seed interview: brands, products, printed objects &mdash; not adjectives.')));
  }
  if (interview.antiReference) {
    /* Q5 stays a bare string in old files and gains a why as { name, why }. */
    const anti = typeof interview.antiReference === 'object'
      ? callout('Not this', `<strong>${escapeHtml(interview.antiReference.name || '')}</strong>${
          interview.antiReference.why ? ` &middot; ${escapeHtml(interview.antiReference.why)}` : ''}`)
      : callout('Not this', escapeHtml(interview.antiReference));
    parts.push(block('Anti-reference', anti
      + note('Q5 of the seed interview. A hard constraint on every palette and pair that followed.')));
  }
  /* Assets: an object entry carries a staged file under
     .impeccable/design-context/assets/ and renders as an image; a plain
     string keeps the text line it always had. A logo is proofed on two
     chips, the committed primary and the committed neutral, so a colored
     and a quiet ground are judged at once; boards and references get a
     wide frame. A file that fails to load hides its own entry (the
     delegated error listener), never the article. */
  const assets = Array.isArray(s.context?.assets) ? s.context.assets : [];
  const isFileAsset = (entry) => Boolean(entry) && typeof entry === 'object'
    && typeof entry.file === 'string' && entry.file;
  const fileAssets = assets.filter(isFileAsset);
  const textAssets = assets.filter((entry) => !isFileAsset(entry));
  const logos = fileAssets.filter((entry) => entry.kind === 'logo');
  const boards = fileAssets.filter((entry) => entry.kind !== 'logo');
  const assetCaption = (entry) => `
      <figcaption class="dcx-asset-caption">
        <code>${escapeHtml(entry.file)}</code>${entry.note ? `
        <p>${escapeHtml(entry.note)}</p>` : ''}
      </figcaption>`;
  const chipHex = (roleName) => s.palette.find((entry) => entry.role === roleName)?.hex || '';
  if (logos.length) {
    parts.push(block('Marks', `<div class="dcx-marks">${logos.map((entry) => `
      <figure class="dcx-mark" data-dcx-hide-on-error>
        <div class="dcx-mark-pair">
          <span class="dcx-mark-chip"${chipHex('Primary') ? ` style="--chip-ground:${chipHex('Primary')};"` : ''}><img src="${brandAssetSrc(entry.file)}" alt="${escapeHtml(entry.file)} on the primary color" /></span>
          <span class="dcx-mark-chip"${chipHex('Neutral') ? ` style="--chip-ground:${chipHex('Neutral')};"` : ''}><img src="${brandAssetSrc(entry.file)}" alt="${escapeHtml(entry.file)} on the neutral color" /></span>
        </div>
        ${assetCaption(entry)}
      </figure>`).join('')}</div>`
      + note('Provided marks proofed on the committed primary and neutral grounds. The files are staged in <code>.impeccable/design-context/assets/</code>.')));
  }
  if (boards.length) {
    parts.push(block('Boards and references', `<div class="dcx-boards">${boards.map((entry) => `
      <figure class="dcx-board" data-dcx-hide-on-error>
        <span class="dcx-board-frame"><img src="${brandAssetSrc(entry.file)}" alt="${escapeHtml(entry.file)}" loading="lazy" /></span>
        ${assetCaption(entry)}
      </figure>`).join('')}</div>`
      + note('Boards and reference images provided in chat, staged in <code>.impeccable/design-context/assets/</code>.')));
  }
  if (textAssets.length) {
    parts.push(block('Assets provided', list(textAssets.map((entry) => escapeHtml(
      typeof entry === 'string' ? entry : (entry.note || entry.file || ''),
    )))
      + note('Gathered before the interview; the questions were grounded in what they showed.')));
  }
  return parts.join('');
}

/* The role descriptions the palette screen taught with, reused so the board
   reads like the screen that made the decision. */
const ROLE_STORY = {
  Primary: 'Your main brand color: buttons, links, the color people remember.',
  Secondary: 'Supports the primary: section accents, hovers, secondary buttons.',
  Tertiary: 'The rare accent: badges, highlights, one detail per screen.',
  Neutral: 'Backgrounds and large surfaces: most of every page.',
};

function buildColor(s, name) {
  const interview = s.context?.interview || {};
  const parts = [heading(4, 'Color', 'Palette, roles, per-surface strategy, copyable values.', name)];
  /* The chosen cue: the image the palette was sampled from, its four sample
     points marked at the cues.json coordinates in each role's dealt color,
     and the rest of the generated set dimmed below. Skipped without ceremony
     when the palette came from a seed deck or a custom pick rather than a
     cue, or when the run had no cues at all.

     The image itself comes from the store, where the submit put a copy of the
     one that was picked, so a document reopened after the generation workspace
     was cleaned still has its cue. The workspace only has to still be there
     for the sample dots and the directions not taken. */
  const cueSlugs = Array.isArray(s.cueSlugs) ? s.cueSlugs : [];
  /* A document opened on its own reads the cue out of the store, so the
     generation workspace no longer has to still list it. A palette that never
     came from a cue has no copy there either, and the whole block hides itself
     when the image fails, which is the same answer arrived at later. */
  const chosenCue = s.paletteSource && (docMode || cueSlugs.includes(s.paletteSource))
    ? s.paletteSource
    : '';
  if (chosenCue && s.palette.length) {
    const cuePalette = seedPalettes?.[chosenCue] || {};
    const dots = ROLES.map((role) => {
      const slot = cuePalette[role];
      if (!slot || !Array.isArray(slot.at) || slot.at.length !== 2) return '';
      const fill = String(slot.snapped || slot.hex || '');
      return `<span class="dcx-cue-dot" data-role="${role}" style="--at-x:${Number(slot.at[0]) || 0}; --at-y:${Number(slot.at[1]) || 0};${fill ? ` --dot-fill:${escapeHtml(fill)};` : ''}"></span>`;
    }).join('');
    const roleRows = s.palette.map((entry) => `
      <div class="dcx-cue-role">
        <span class="dcx-cue-role-dot" style="--dot-fill:${entry.hex};"></span>
        <span class="dcx-cue-role-name">${escapeHtml(entry.role)}</span>
        <code>${entry.hex}</code>
        <code>${escapeHtml(formatOklch(entry.hex))}</code>
      </div>`).join('');
    parts.push(block('The cue', `<div class="dcx-cue" data-dcx-hide-on-error>
        <figure class="dcx-cue-frame">
          <img data-dcx-cue-img src="${cueImageSrc(chosenCue)}" alt="The chosen visual cue, ${escapeHtml(chosenCue)}" />
          ${dots}
        </figure>
        <div class="dcx-cue-card">
          <span class="dcx-cue-tag">Chosen cue</span>
          <h3 class="dcx-cue-name">${escapeHtml(chosenCue)}</h3>
          ${roleRows}
        </div>
      </div>`
      + note('The image the palette was sampled from, each role&rsquo;s sample point marked in its dealt color. The values beside it are the committed ones, which move when a role is edited after sampling.')));
    const others = cueSlugs.filter((slug) => slug !== chosenCue);
    if (others.length) {
      parts.push(block('Also generated', `<div class="dcx-cue-strip">${others.map((slug) => `
        <figure class="dcx-cue-thumb" data-dcx-hide-on-error>
          <img src="/cues/${encodeURIComponent(slug)}.png" alt="" loading="lazy" />
          <figcaption>${escapeHtml(slug)}</figcaption>
        </figure>`).join('')}</div>`
        + note('The directions not taken, kept on disk in <code>.impeccable/visual-cues/</code>.')));
    }
  }
  if (s.palette.length) {
    const step = 100 / (s.palette.length + 1);
    const fan = s.palette.map((entry, index) => `
      <button class="dcx-fan-panel" type="button" data-copy-color="${entry.hex}" data-color-name="${escapeHtml(entry.role)}"
        style="--panel-left:${index * step}%; --panel-z:${index + 1}; --panel-swatch:${entry.hex}; --panel-ink:${inkFor(entry.hex)};"
        aria-label="Copy ${escapeHtml(entry.role)} ${entry.hex}">
        <span class="dcx-fan-info"><span class="dcx-fan-name">${escapeHtml(entry.role)}</span><span class="dcx-fan-value">${entry.hex}</span></span>
      </button>`).join('');
    parts.push(block('Palette', `<div class="dcx-fan" role="group" aria-label="Chosen palette, click a panel to copy its value">${fan}</div>`
      + note(`Committed on the palette screen${s.paletteSource ? ` from the <code>${escapeHtml(s.paletteSource)}</code> cue` : ''}, roles in the order you arranged them. Hover to fan; click to copy the hex.`)));

    /* One full-width band per role: the swatch at real size with both value
       notations, the role's job, the ink that survives on it, where the value
       came from, and a copy affordance. The provenance tag compares the
       committed value against the winning cue's dealt value and stays away
       when the source is not a cue; the ink chip is a pure derivation and
       always renders. */
    const colorContext = s.context?.color || {};
    parts.push(block('Roles and values', `<div class="dcx-swatches">${s.palette.map((entry) => {
      const inkHex = contrastInkHex(entry.hex);
      const seedHex = seedHexFor(s.paletteSource, entry.role.toLowerCase());
      const provenance = seedHex ? (seedHex === entry.hex ? 'as dealt' : 'edited') : '';
      return `
      <div class="dcx-swatch" data-role="${entry.role.toLowerCase()}">
        <button class="dcx-swatch-chip" type="button" data-copy-color="${entry.hex}" data-color-name="${escapeHtml(entry.role)}"
          style="--swatch:${entry.hex}; --swatch-ink:${inkFor(entry.hex)};" aria-label="Copy ${escapeHtml(entry.role)} ${entry.hex}">
          <span class="dcx-swatch-hex">${entry.hex}</span>${provenance ? `
          <span class="dcx-swatch-provenance" data-provenance="${provenance === 'edited' ? 'edited' : 'as-dealt'}">${provenance}</span>` : ''}
          <span class="dcx-swatch-copy-hint">Copy</span>
        </button>
        <div class="dcx-swatch-meta">
          <h3>${escapeHtml(entry.role)}</h3>
          <p>${escapeHtml(ROLE_STORY[entry.role] || '')}</p>
          <code>${escapeHtml(formatOklch(entry.hex))}</code>
          <span class="dcx-ink-pair"><span class="dcx-ink-tag">Ink</span><span class="dcx-ink-sample" style="--ink-ground:${entry.hex}; --ink-text:${inkHex};">${inkHex}</span></span>
        </div>
      </div>`;
    }).join('')}</div>`
      + (Array.isArray(colorContext.assetLocks) && colorContext.assetLocks.length
        ? note(`From the assets: ${colorContext.assetLocks.map(escapeHtml).join(' &middot; ')}.`)
        : '')));

    /* Every chosen surface gets its artboard back, remapped by the strategy
       that surface answered with — the strategy screen's preview, kept. */
    parts.push(block('Strategy per surface', `<div class="dcx-surfaces" data-count="${s.strategy.length}">${s.strategy.map((entry) => `
      <article class="dcx-surface-card">
        ${proofHtml(surfaceBoard(entry.mode) || surfaceTilePreview(entry.mode), { strategy: entry.value, kind: 'board' })}
        <div class="dcx-surface-copy">
          <h3 class="dcx-surface-name">${escapeHtml(entry.label)} &middot; <em>${escapeHtml(entry.title)}</em>${entry.chosen ? '' : ' <span class="dcx-default-mark">default</span>'}</h3>
          <p class="dcx-surface-goal">${escapeHtml(entry.desc)}</p>
        </div>
      </article>`).join('')}</div>`
      + note('How much of each surface the palette is allowed to carry, drawn the way the strategy screen previewed it. Options a surface cannot take were withheld there.')));
  } else {
    parts.push(block('Palette', empty('No palette committed', 'The palette screen was not completed on this run.')));
    parts.push(block('Strategy per surface', surfaceDefs(s.strategy)));
  }
  if (interview.colorStrategy || interview.hueAnchor) {
    parts.push(block('Interview direction', defs([
      interview.colorStrategy && { dt: 'Strategy asked for', dd: escapeHtml(interview.colorStrategy) },
      interview.hueAnchor && { dt: 'Hue anchor', dd: escapeHtml(interview.hueAnchor) },
    ].filter(Boolean)) + note('Q1 of the seed interview. The cues were generated from this; the picks above are the decision.')));
  }
  return parts.join('');
}

function buildTypography(s, name) {
  const interview = s.context?.interview || {};
  const parts = [heading(5, 'Typography', 'Font families, type scale, hierarchy.', name)];
  if (s.fonts.heading) {
    /* Each family gets the fonttrio anatomy the font screen used: the name
       set large in its own face, then a sentence in the partner. */
    parts.push(block('The pair', `<div class="dcx-pair">
        <article class="dcx-pair-card">
          <span class="dcx-pair-role">Headings</span>
          <p class="dcx-pair-name" style="font-family:'${escapeHtml(s.fonts.heading)}', serif;">${escapeHtml(s.fonts.heading)}</p>
          ${s.fonts.headingSource ? `<code class="dcx-pair-source">${escapeHtml(s.fonts.headingSource)}</code>` : ''}
        </article>
        <article class="dcx-pair-card">
          <span class="dcx-pair-role">Body</span>
          <p class="dcx-pair-name" style="font-family:'${escapeHtml(s.fonts.body)}', sans-serif;">${escapeHtml(s.fonts.body)}</p>
          ${s.fonts.bodySource ? `<code class="dcx-pair-source">${escapeHtml(s.fonts.bodySource)}</code>` : ''}
        </article>
      </div>
      <p class="dcx-pair-why" style="font-family:'${escapeHtml(s.fonts.body)}', sans-serif;">${escapeHtml(s.fonts.why || 'Chosen on the font pair screen against every surface this product ships.')}</p>`));
  } else {
    parts.push(block('The pair', empty('No pair selected', 'The font pair screen was not completed on this run.')));
  }
  if (s.scale.ratio) {
    /* The scale screen's sheet, cloned with its computed sizes: every step
       at true rendered size in the chosen faces, px and rem alongside. */
    parts.push(block('Type scale', `<p class="dcx-scale-head"><strong>${escapeHtml(s.scale.name)}</strong> &middot; ratio <code>${s.scale.ratio.toFixed(3)}</code> on a 16px base. ${escapeHtml(s.scale.desc)}</p>`
      + proofHtml($('[data-scale-sheet]'), { kind: 'scale' })
      + note('The scale screen&rsquo;s sheet, kept at rendered size in the chosen faces. Values at a 16px base.')));
    parts.push(block('In running text', proofHtml($('[data-scale-specimen]'), { kind: 'specimen' })
      + note('The same scale on the components a page is built from &mdash; headings, ledes, lists, quotes, code.')));
  }
  if (interview.typeDirection) {
    parts.push(block('Interview direction', callout('Direction asked for', escapeHtml(interview.typeDirection))
      + note('Q2 of the seed interview. All six candidate pairs were composed inside this direction.')));
  }
  return parts.join('');
}

function buildIconography(s, name) {
  const parts = [heading(6, 'Iconography', 'Icon library, license, where it lives.', name)];
  if (s.icons.pack) {
    /* The glyphs are fetched when screen 11 first opens, so a fast run can
       reach the document before any landed, and a failed fetch leaves only
       an error line. A sheet with no icon cells proves nothing about the
       hand, so it is dropped rather than framed. */
    const sheetSource = $('[data-icon-sheet]');
    const sheet = sheetSource?.querySelector('.picker-icon-cell') ? proofHtml(sheetSource, { kind: 'icons' }) : '';
    if (sheet) {
      parts.push(block('The hand', sheet
        + note(`${escapeHtml(s.icons.pack)}&rsquo;s canonical set, as the icons screen previewed it. One pack, one hand: no mixed sets.`)));
    }
    /* The chosen radio's own row copy: the character note and the grid,
       stroke, and license summary the screen showed beside the name. Read
       off the DOM rather than kept twice, the optionCopy convention. */
    const packLabel = form.querySelector('input[name="icon-pack"]:checked')?.closest('label');
    const packNote = packLabel?.querySelector('.picker-strategy-desc')?.textContent.trim() || '';
    const packMeta = packLabel?.querySelector('.picker-icon-meta')?.textContent.trim() || '';
    parts.push(block('Library', defs([
      { dt: 'Pack', dd: `<strong>${escapeHtml(s.icons.pack)}</strong>${packMeta ? ` &middot; ${escapeHtml(packMeta)}` : ''}` },
      packNote ? { dt: 'Why this hand', dd: escapeHtml(packNote) } : null,
      s.icons.license ? { dt: 'License', dd: escapeHtml(s.icons.license) } : null,
      s.icons.url ? { dt: 'Home', dd: `<a href="${escapeHtml(s.icons.url)}" target="_blank" rel="noopener">${escapeHtml(s.icons.url)}</a>` } : null,
    ].filter(Boolean)) + note('Chosen on the icons screen. The pack names the hand; stroke weight and metaphor rules resolve during implementation.')));
  } else {
    parts.push(block('Library', empty('No pack selected', 'The icons screen was not completed on this run.')));
  }
  return parts.join('');
}

/* A per-surface question laid out the way its screen asked it: one card per
   surface, the pick's title carrying the card, the description under it. */
const pickGrid = (entries, preview = null) => `<div class="dcx-picks" data-count="${entries.length}">${entries.map((entry) => `
  <article class="dcx-pick${preview ? ' dcx-pick--proof' : ''}">
    <span class="dcx-pick-surface">${escapeHtml(entry.label)}${entry.chosen ? '' : ' <span class="dcx-default-mark">default</span>'}</span>
    <h3 class="dcx-pick-title">${escapeHtml(entry.title)}</h3>
    <p class="dcx-pick-desc">${escapeHtml(entry.desc)}</p>${preview ? preview(entry) : ''}
  </article>`).join('')}</div>`;

function buildMaterial(s, name) {
  const interview = s.context?.interview || {};
  const parts = [heading(7, 'Material', 'Motion, layout structure, boundaries, corners, depth.', name)];
  /* Every structural answer on one drawing per surface: the boundaries
     screen's carried artboard, cloned with the surface's committed strategy
     and material answers restated on its frame. A surface with no board in
     the DOM drops its card rather than framing nothing. */
  const proofCards = s.surfaces.map((surface) => {
    const board = carriedBoard(surface.mode);
    if (!board) return '';
    return `
    <article class="dcx-surface-card">
      ${proofHtml(board, {
        strategy: s.strategy.find((entry) => entry.mode === surface.mode)?.value || '',
        kind: 'board',
        marks: materialMarks(s, surface.mode),
      })}
      <div class="dcx-surface-copy">
        <h3 class="dcx-surface-name">${escapeHtml(surface.label)}</h3>
      </div>
    </article>`;
  }).filter(Boolean);
  if (proofCards.length) {
    parts.push(block('The page, as chosen', `<div class="dcx-surfaces" data-count="${proofCards.length}">${proofCards.join('')}</div>`
      + note('Each surface&rsquo;s page anatomy carrying every structural answer below at once, the way the question screens accumulated them: color strategy, layout, boundaries, corners, depth.')));
  }
  /* Movement is only asked of the two surfaces that make a claim on attention,
     so this list is one or two entries long and empty on a run of neither. An
     empty one says the question was never put, which is a different thing from
     a quiet answer and is worth saying out loud. */
  if (s.motion.length) {
    parts.push(block('Motion per surface', pickGrid(s.motion, (e) => proofHtml(motionBoard(e.mode, e.value), { kind: 'board', marks: materialMarks(s, e.mode) }))
      + note(interview.motionEnergy
        ? `The seed interview asked for <strong>${escapeHtml(interview.motionEnergy)}</strong>; the motion screen answered it per surface above.`
        : 'Asked of the landing page and the portfolio only. A tool and a document are moved through rather than watched, so their movement follows the interface rather than a house style.')));
  } else {
    parts.push(block('Motion', empty(
      'Not asked on this run',
      'The motion screen is shown for a landing page and a portfolio. This run has neither, so no motion energy was chosen and none is recorded.',
    )));
  }
  /* Asked of the same two surfaces as movement, and left out on a run of
     neither. Movement's own block above already says the screen was not part of
     the run, so this one goes quiet rather than repeating it. */
  if (s.layout.value) {
    parts.push(block('Layout structure', callout(s.layout.title, escapeHtml(s.layout.desc))
      + note('Asked of the landing page and the portfolio, where the composition of the page is itself the decision. One answer is kept for the run, and every surface is drawn on it.')));
  }
  parts.push(block('Boundaries per surface', pickGrid(s.boundaries, (e) => proofHtml(questionBoard('boundaries', e.mode), { kind: 'board', marks: materialMarks(s, e.mode) }))
    + note('How sections separate on each surface.')));
  parts.push(block('Corners per surface', pickGrid(s.corners, (e) => proofHtml(questionBoard('corners', e.mode), { kind: 'board', marks: materialMarks(s, e.mode) }))
    + note('How round shapes are on each surface.')));
  parts.push(block('Depth per surface', pickGrid(s.depth, (e) => proofHtml(questionBoard('depth', e.mode), { kind: 'board', marks: materialMarks(s, e.mode) }))
    + note('How far off the page things sit on each surface.')));
  return parts.join('');
}

function buildInterface(s, name) {
  const parts = [heading(8, 'Interface', 'Per-surface decisions at a glance, component status.', name)];
  parts.push(block('Decisions per surface', `<div class="dcx-surfaces" data-count="${s.surfaces.length}">${s.surfaces.map((surface) => {
    const strategyValue = s.strategy.find((entry) => entry.mode === surface.mode)?.value || '';
    const board = carriedBoard(surface.mode);
    /* The matrix quotes every per-surface answer. A question this surface
       was never asked reads Not asked rather than borrowing another
       surface's answer; layout is one answer for the run and is quoted on
       every card, the rule the Material page states. */
    const rows = [
      ['Color strategy', s.strategy.find((entry) => entry.mode === surface.mode)],
      ['Boundaries', s.boundaries.find((entry) => entry.mode === surface.mode)],
      ['Corners', s.corners.find((entry) => entry.mode === surface.mode)],
      ['Depth', s.depth.find((entry) => entry.mode === surface.mode)],
      ['Motion', s.motion.find((entry) => entry.mode === surface.mode)],
      ['Layout', s.layout.value ? s.layout : undefined],
    ];
    return `
    <article class="dcx-surface-card">
      ${board
        ? proofHtml(board, { strategy: strategyValue, kind: 'board', marks: materialMarks(s, surface.mode) })
        : proofHtml(surfaceBoard(surface.mode) || surfaceTilePreview(surface.mode), { strategy: strategyValue, kind: 'board' })}
      <div class="dcx-surface-copy">
        <h3 class="dcx-surface-name">${escapeHtml(surface.label)}</h3>
        <dl class="dcx-matrix">${rows.map(([label, entry]) => `
          <div class="dcx-matrix-row"><dt>${escapeHtml(label)}</dt><dd>${entry ? escapeHtml(entry.title) : 'Not asked'}${entry && !entry.chosen ? ' <span class="dcx-default-mark">default</span>' : ''}</dd></div>`).join('')}</dl>
      </div>
    </article>`;
  }).join('')}</div>`
    + note('Each surface&rsquo;s anatomy carrying its committed answers, with every per-surface decision beneath it.')));
  /* The run's own tokens in one place: what the seed DESIGN.md frontmatter
     will carry. Every row omits when its screen was not completed. */
  const kit = [
    s.fonts.heading ? { dt: 'Faces', dd: `<strong>${escapeHtml(s.fonts.heading)}</strong> for headings, <strong>${escapeHtml(s.fonts.body)}</strong> for body` } : null,
    s.scale.ratio ? { dt: 'Type scale', dd: `<strong>${escapeHtml(s.scale.name)}</strong> &middot; ratio <code>${s.scale.ratio.toFixed(3)}</code> on a 16px base` } : null,
    s.icons.pack ? { dt: 'Icons', dd: `<strong>${escapeHtml(s.icons.pack)}</strong>${s.icons.license ? ` &middot; ${escapeHtml(s.icons.license)}` : ''}` } : null,
    s.palette.length ? { dt: 'Palette', dd: s.palette.map((entry) => `<code>${entry.hex}</code>`).join(' &middot; ') } : null,
    s.layout.value ? { dt: 'Layout', dd: `<strong>${escapeHtml(s.layout.title)}</strong>, one answer for the run` } : null,
  ].filter(Boolean);
  if (kit.length) {
    parts.push(block('The kit', defs(kit)
      + note('The tokens the seed DESIGN.md will carry in its frontmatter, gathered from their own pages in this document.')));
  }
  parts.push(block('Components', empty(
    'No component library seeded yet',
    'Components are documented on the first scan pass, once there is code to capture actual tokens and states from. Re-run <code>/impeccable document</code> then.',
  )));
  return parts.join('');
}

const BUILDERS = {
  audience: buildAudience,
  product: buildProduct,
  brand: buildBrand,
  color: buildColor,
  typography: buildTypography,
  iconography: buildIconography,
  material: buildMaterial,
  interface: buildInterface,
};

/* What each chosen surface is, in the document's own register. The new document
   replaces the material article's preview boards with these definitions
   (dcx-detail.js reads window.dcxSurfaceDefs); persuade and experience carry the
   standalone demo's sentences verbatim. */
const MODE_DEFS = {
  persuade: 'A public-facing page that introduces the experience and guides visitors toward its primary action.',
  operate: 'A working surface for completing tasks, where familiar patterns and a predictable layout come first.',
  read: 'A reading surface for understanding, where type, structure, and pacing carry the page.',
  experience: 'A project-led page for presenting selected work, its context, and its outcomes.',
};

function renderDocument() {
  const snapshot = takeSnapshot();
  window.dcxSurfaceDefs = snapshot.surfaces.map((surface) => ({
    label: surface.label,
    description: MODE_DEFS[surface.mode] || surface.goal || '',
  }));
  const name = snapshot.context?.product?.name || '';
  /* Bridges for the document engine, whose modules read globals rather than
     importing this file. The cue URL is empty when the palette came from a
     seed deck or a custom pick, which keeps the vendored card photo; the
     product name fills the specimen fields that would otherwise show another
     studio's. */
  const dealtCues = Array.isArray(snapshot.cueSlugs) ? snapshot.cueSlugs : [];
  const chosenCue = snapshot.paletteSource && (docMode || dealtCues.includes(snapshot.paletteSource))
    ? snapshot.paletteSource
    : '';
  window.dcxCueImageSrc = chosenCue ? cueImageSrc(chosenCue) : '';
  window.dcxProductName = name;
  /* The components inventory reads the committed palette through --pkc-* on
     <body>: its article is rebuilt on every remount, so the paint lives on the
     one node that survives. A run that never committed a full palette leaves
     the gate off and keeps the vendored demo colors. */
  const paletteLive = ROLES.every((role) => fieldValue(`palette-${role}`));
  document.body.classList.toggle('dcx-palette-live', paletteLive);
  if (paletteLive) paintCommitted(document.body);
  /* The rest of the committed kit rides the same node: faces, corners, depth,
     and the scale ratio. Without these the inventory can only be recolored. */
  document.body.classList.toggle('dcx-kit-live', paintKit(document.body, snapshot));
  for (const [id, build] of Object.entries(BUILDERS)) {
    const template = document.getElementById(`dcx-detail-${id}`);
    template.innerHTML = `<article class="dcx-article">${build(snapshot, name)}</article>`;
  }
  if (name) document.title = `Design context — ${name}`;
}

/* ============================================================
   Finish sequence — save, then reveal.
   ============================================================ */

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function collectAnswers() {
  const answers = {};
  for (const [name, value] of new FormData(form)) {
    if (!(name in answers)) answers[name] = value;
    else answers[name] = Array.isArray(answers[name]) ? [...answers[name], value] : [answers[name], value];
  }
  /* The visible radio follows whichever surface tab was shown last, so the bare
     key can leave carrying a trailing surface's answer. The leading surface owns
     it: restate it from that surface's own field before this goes to disk. */
  const chosen = [].concat(answers['surface-modes'] || []);
  const leading = SURFACE_ORDER.filter((mode) => chosen.includes(mode));
  for (const key of PER_SURFACE) {
    if (!(key in answers)) continue;
    const owner = leading.find((mode) => answers[`${key}-${mode}`]);
    if (owner) answers[key] = answers[`${key}-${owner}`];
  }
  return answers;
}

async function submitAnswers() {
  const response = await fetch('/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(collectAnswers()),
  });
  /* 409 means an earlier attempt landed before its response was read; the
     answers are on disk, which is all this step owes. */
  if (!response.ok && response.status !== 409) throw new Error(`Submit failed: ${response.status}`);
  if (response.ok) {
    const body = await response.json().catch(() => null);
    if (body?.doc?.base && body?.doc?.token) startDocSession(body.doc);
  }
}

async function finishSequence() {
  const errorBox = $('[data-doc-error]');
  const loader = $('[data-doc-loader]');
  errorBox.hidden = true;
  loader.removeAttribute('data-stalled');

  renderDocument();

  try {
    /* The pause is real work plus a floor: the document is already built, but
       a reveal that beats the reader's blink reads as a broken redirect. */
    await Promise.all([submitAnswers(), wait(2400)]);
    revealDocument();
  } catch {
    loader.setAttribute('data-stalled', '');
    errorBox.hidden = false;
  }
}

let finished = false;
document.addEventListener('picker:screenchange', ({ detail }) => {
  if (detail.screen !== '12' || finished) return;
  finished = true;
  finishSequence();
});

/* Document mode: the run already happened, so the document renders from the
   store instead of waiting on a submit that will never come.

   Everything it reads has to be in hand before the first render, because
   nothing re-renders it afterwards on its own: the version the tab compares
   against and the version a fresh session starts at are both 1, so a render
   that raced its own data would stay wrong until an edit moved the number.
   That means the context and cue fetches, the restored form, and the icon
   sheet, which the questionnaire otherwise fetches only when its screen is
   reached and whose absence quietly drops a block from the document. */
getBoot().then(async (boot) => {
  if (boot.mode !== 'doc') return;
  docMode = true;
  // Nothing here submits, and there is no half-finished run to save.
  finished = true;
  await Promise.all([cuesReady, contextReady, hydrationReady, loadIconPacks().catch(() => {})]);
  if (boot.doc?.base && boot.doc?.token) startDocSession(boot.doc);
  renderDocument();
  revealDocument();
});

/* A run walked away from is a run that can be resumed: the whole form goes to
   the server after every screen, so closing the tab costs the visitor nothing
   but the trip. Debounced because arrow keys can walk several screens faster
   than a request completes, and dropped silently on failure, since a draft the
   server never took is only the resume that will not happen. */
let draftTimer;
document.addEventListener('picker:screenchange', () => {
  if (finished) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    if (finished) return;
    fetch('/autosave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collectAnswers()),
    }).catch(() => {});
  }, 500);
});

$('[data-doc-retry]')?.addEventListener('click', finishSequence);

/* ============================================================
   Reveal — the shell's own entrance, and the stroke sizing its
   tile vignettes need. The document itself (morph, sidebar,
   scroll-spy, hash routing) is the engine's, in scripts/dcx/.
   ============================================================ */

let revealed = false;

function revealDocument() {
  revealed = true;
  document.body.classList.add('dcx-open');
  shell.hidden = false;
  window.scrollTo(0, 0);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      $$('[data-reveal]', shell).forEach((el) => el.classList.add('revealed'));
      sizeDrawStrokes();
    });
  });
}

/* Vignette draw animations use the homepage's stroke-dasharray: 100
   (user units), but non-scaling-stroke makes Chromium measure dashes in
   screen pixels. Translate: --pl = 100 viewBox units at the rendered
   scale, refreshed on resize. */
function sizeDrawStrokes() {
  $$('.dcx-viz-svg').forEach((svg) => {
    const paths = $$('.anim-draw, .anim-draw-delay', svg);
    if (!paths.length) return;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const scale = Math.min(rect.width, rect.height) / 40;
    paths.forEach((path) => {
      /* The homepage icons fit inside dasharray 100; custom paths longer
         than 60 units (breathe shows the first 60% of the dash) get a
         proportionally larger dash so they still finish drawing. */
      const units = Math.max(100, path.getTotalLength() / 0.6);
      path.style.setProperty('--pl', `${(units * scale).toFixed(1)}px`);
    });
  });
}
let drawResizeTimer;
window.addEventListener('resize', () => {
  window.clearTimeout(drawResizeTimer);
  drawResizeTimer = window.setTimeout(() => { if (revealed) sizeDrawStrokes(); }, 150);
});

/* ============================================================
   Live edit session — the document as a working surface.

   The picker server forks a doc-session sibling on submit and hands
   this tab its address and token.

   The tab learns about the outside world the way live mode's browser
   does, scaled to polling: /doc/state every couple of seconds, and a
   version bump means re-read the store and rebuild.
   ============================================================ */

let docSession = null;
let docVersion = 1;
let docOnline = false;
let trayRequests = [];

const tray = $('[data-dcx-tray]');

function startDocSession(doc) {
  docSession = doc;
  /* The dcx modules build their image URLs through dcxAsset(), which routes via
     the session from the moment one exists — before the first refresh below. */
  window.dcxDocSession = doc;
  document.body.classList.add('dcx-live');
  /* Rebuild the templates with this session's URLs: brand-asset images can
     only load through the session, because the picker server exits right
     after submit and article images fetch after that exit. */
  refreshDocument();
  schedulePoll(1500);
}

let pollTimer;
function schedulePoll(ms) {
  window.clearTimeout(pollTimer);
  pollTimer = window.setTimeout(pollDocState, ms);
}

async function pollDocState() {
  if (!docSession) return;
  try {
    const response = await fetch(`${docSession.base}/doc/state?token=${encodeURIComponent(docSession.token)}`);
    if (!response.ok) throw new Error('state');
    const state = await response.json();
    setDocOnline(true);
    trayRequests = state.requests || [];
    renderTray();
    if (state.version !== docVersion) {
      docVersion = state.version;
      /* Something moved on disk: a request the agent finished, or a value it
         settled while doing so. Re-read both halves of the store and rebuild;
         the document engine re-mounts the open document and holds the reader's
         scroll position. */
      await adoptStoreState();
      refreshDocument();
    }
    schedulePoll(2000);
  } catch {
    setDocOnline(false);
    renderTray();
    schedulePoll(8000);
  }
}

function setDocOnline(value) {
  docOnline = value;
  document.body.classList.toggle('dcx-live', Boolean(docSession) && value);
}

/* The form is still the single source the renderer reads, so an edit made
   anywhere lands there: values fetched back from answers.json are written
   into the same named fields the questionnaire filled. */
async function adoptAnswers() {
  const response = await fetch(`${docSession.base}/doc/answers?token=${encodeURIComponent(docSession.token)}`);
  if (!response.ok) return;
  const { answers } = await response.json();
  for (const [name, value] of Object.entries(answers || {})) {
    if (Array.isArray(value) || typeof value !== 'string') continue;
    const field = form.elements[name];
    if (!field) continue;
    if (typeof RadioNodeList !== 'undefined' && field instanceof RadioNodeList) field.value = value;
    else if ('value' in field && field.type !== 'checkbox') field.value = value;
  }
  ensureFace(fieldValue('font-heading'));
  ensureFace(fieldValue('font-body'));
}

/* A family the agent swapped in may not be loaded on this page yet; ask
   Google Fonts for it and let the browser fall back if it is not there. */
function ensureFace(family) {
  if (!family || document.fonts?.check?.(`16px '${family}'`)) return;
  const id = `dcx-face-${family.replace(/\W+/g, '-').toLowerCase()}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@300..800&display=swap`;
  document.head.appendChild(link);
}

/* The chat half moves too: an agent reconciling a batch can rewrite a purpose
   line, and the document is where that has to show up. Assigned onto the same
   variables the boot fetch fills, so every builder reads the new values. */
async function adoptContext() {
  const response = await fetch(`${docSession.base}/doc/context?token=${encodeURIComponent(docSession.token)}`);
  if (!response.ok) return;
  const payload = await response.json();
  if (payload.context && typeof payload.context === 'object') seedContext = payload.context;
  if (Array.isArray(payload.modes)) seedModes = payload.modes;
}

const adoptStoreState = () => Promise.all([adoptAnswers(), adoptContext()]);

function refreshDocument() {
  renderDocument();
  window.dcxDocument?.remount();
}

/* ---------- The tray ---------- */

const TRAY_LABELS = {
  pending: 'Queued for the agent',
  working: 'The agent is on it',
  done: 'Applied',
  error: 'Could not apply',
};

function renderTray() {
  /* One card per request: work the agent owes, and how far along it is. */
  if (!tray) return;
  const items = trayRequests.slice(-4);
  const offline = docSession && !docOnline;
  tray.hidden = !offline && items.length === 0;
  tray.innerHTML = [
    offline ? '<div class="dcx-tray-item" data-status="offline"><span class="dcx-tray-dot"></span><div><p class="dcx-tray-prompt">Edit session offline</p><p class="dcx-tray-note">Changes stay in this tab; reconnecting&hellip;</p></div></div>' : '',
    ...items.map((entry) => `
      <div class="dcx-tray-item" data-status="${escapeHtml(entry.status)}">
        <span class="dcx-tray-dot"></span>
        <div>
          <p class="dcx-tray-prompt">${escapeHtml(entry.prompt)}</p>
          <p class="dcx-tray-note">${escapeHtml(entry.message || TRAY_LABELS[entry.status] || entry.status)}</p>
        </div>
      </div>`),
  ].join('');
}
