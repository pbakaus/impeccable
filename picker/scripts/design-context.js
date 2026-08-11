/* Design context document — the questionnaire's final act.
 *
 * When the run reaches the review screen this module saves the answers, then
 * swaps the picker for the eight-category design context document. The mosaic
 * landing, tile-to-fullscreen morph, sidebar shell, and article vocabulary are
 * ported unchanged from docs/design-context-categorization/design-context.html;
 * what changed is the content: the prototype rendered one example project, this
 * renders the interview that just ended. Everything is assembled client-side
 * before the POST resolves, because the server's exit on /submit is the
 * completion signal the agent waits on — after it there is nothing to fetch.
 */

import { contrastInk, contrastInkHex, formatOklch, readableOn } from './color.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const form = $('#picker-form');
const shell = $('[data-dcx-shell]');

/* Seed context (the chat half of the interview) rides in on cues.json as an
   optional `context` block. Fetched at load, before the server can exit. */
let seedContext = null;
fetch('/cues.json')
  .then((response) => (response.ok ? response.json() : null))
  .then((data) => { seedContext = data?.context || null; })
  .catch(() => {});

/* ============================================================
   Snapshot — everything the document renders, read once.
   ============================================================ */

const ROLES = ['primary', 'secondary', 'tertiary', 'neutral'];
const SURFACE_ORDER = ['persuade', 'operate', 'read', 'experience'];
const PER_SURFACE = ['color-strategy', 'boundary-style', 'corner-style', 'depth-style'];

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
  set('p-on-n', readableOn(colors.primary, colors.neutral));
  set('t-on-n', readableOn(colors.tertiary, colors.neutral));
  set('t-on-p', readableOn(colors.tertiary, colors.primary));
  set('p-on-p', readableOn(colors.primary, colors.primary));
  set('t-on-t', readableOn(colors.tertiary, colors.tertiary));
  set('p-on-i', readableOn(colors.primary, contrastInkHex(colors.primary)));
}

/* Clone one questionnaire drawing into a dcx frame. Inline styles travel
   with the clone; ids do not (they would collide with the originals). */
function proofHtml(source, { strategy = '', kind = 'board', marks = null } = {}) {
  if (!source) return '';
  const clone = source.cloneNode(true);
  clone.hidden = false;
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
const carriedBoard = (mode) => $(`[data-question="boundaries"] .picker-artboard[data-surface="${mode}"]`);

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
  return `<div class="dcx-surfaces" data-count="${s.surfaces.length}">${s.surfaces.map((surface) => `
    <article class="dcx-surface-card">
      ${proofHtml(surfaceBoard(surface.mode) || surfaceTilePreview(surface.mode), { kind: 'board' })}
      <div class="dcx-surface-copy">
        <h3 class="dcx-surface-name">${escapeHtml(surface.label)}</h3>
        ${body(surface)}
      </div>
    </article>`).join('')}</div>`;
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
  if (Array.isArray(product.clarities) && product.clarities.length) {
    parts.push(block('What must be clear first', list(product.clarities.map(escapeHtml))));
  }
  if (product.operatingContext) {
    parts.push(block('Operating context', `<p class="dcx-prose">${escapeHtml(product.operatingContext)}</p>`));
  }
  parts.push(block('Surfaces', surfaceCards(s, (surface) => `
      <p class="dcx-surface-goal">${surface.goal ? escapeHtml(surface.goal) : ''}</p>
      ${surface.examples.length ? chips(surface.examples) : ''}`)
    + note('Chosen on the questionnaire&rsquo;s first screen, drawn in the committed palette; every per-surface answer in this document is keyed to this set.')));
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
  if (Array.isArray(s.context?.assets) && s.context.assets.length) {
    parts.push(block('Assets provided', list(s.context.assets.map(escapeHtml))
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
       notations, the role's job, and a copy affordance. */
    parts.push(block('Roles and values', `<div class="dcx-swatches">${s.palette.map((entry) => `
      <div class="dcx-swatch" data-role="${entry.role.toLowerCase()}">
        <button class="dcx-swatch-chip" type="button" data-copy-color="${entry.hex}" data-color-name="${escapeHtml(entry.role)}"
          style="--swatch:${entry.hex}; --swatch-ink:${inkFor(entry.hex)};" aria-label="Copy ${escapeHtml(entry.role)} ${entry.hex}">
          <span class="dcx-swatch-hex">${entry.hex}</span>
          <span class="dcx-swatch-copy-hint">Copy</span>
        </button>
        <div class="dcx-swatch-meta">
          <h3>${escapeHtml(entry.role)}</h3>
          <p>${escapeHtml(ROLE_STORY[entry.role] || '')}</p>
          <code>${escapeHtml(formatOklch(entry.hex))}</code>
          <span class="dcx-swatch-actions">
            <button class="dcx-edit" type="button" data-edit-color="${entry.role.toLowerCase()}">Edit color</button>
            <input class="dcx-native-color" type="color" value="${entry.hex}" data-color-input-for="${entry.role.toLowerCase()}"
              tabindex="-1" aria-label="Pick a new ${escapeHtml(entry.role)} color" />
          </span>
        </div>
      </div>`).join('')}</div>`));

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
      <p class="dcx-pair-why" style="font-family:'${escapeHtml(s.fonts.body)}', sans-serif;">${escapeHtml(s.fonts.why || 'Chosen on the font pair screen against every surface this product ships.')}</p>
      <button class="dcx-edit" type="button" data-dcx-request-kind="font">Change the fonts&hellip;</button>`));
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
const pickGrid = (entries) => `<div class="dcx-picks" data-count="${entries.length}">${entries.map((entry) => `
  <article class="dcx-pick">
    <span class="dcx-pick-surface">${escapeHtml(entry.label)}${entry.chosen ? '' : ' <span class="dcx-default-mark">default</span>'}</span>
    <h3 class="dcx-pick-title">${escapeHtml(entry.title)}</h3>
    <p class="dcx-pick-desc">${escapeHtml(entry.desc)}</p>
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
    parts.push(block('Motion per surface', pickGrid(s.motion)
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
  parts.push(block('Boundaries per surface', pickGrid(s.boundaries)
    + note('How sections separate on each surface.')));
  parts.push(block('Corners per surface', pickGrid(s.corners)
    + note('How round shapes are on each surface.')));
  parts.push(block('Depth per surface', pickGrid(s.depth)
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

function renderDocument() {
  const snapshot = takeSnapshot();
  const name = snapshot.context?.product?.name || '';
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

$('[data-doc-retry]')?.addEventListener('click', finishSequence);

/* ============================================================
   Reveal + expander — ported from the prototype. The morph,
   subnav, hash routing, fan, and stroke sizing are its code;
   only the theme toggle and site header went (the picker has
   neither).
   ============================================================ */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const MORPH_MS = reduceMotion ? 0 : 540;
const READY_MS = reduceMotion ? 0 : 260;

const tiles = $$('.dcx-tile');
const names = {};
tiles.forEach((tile) => { names[tile.dataset.category] = tile.dataset.name; });
const shellTemplate = document.getElementById('dcx-shell-template');

let current = null;
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
  const initial = location.hash.replace('#', '');
  if (initial && initial in names) {
    window.setTimeout(() => openCategory(initial, false), 120);
  }
}

function copyText(value) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(value).catch(() => fallbackCopy(value));
  }
  fallbackCopy(value);
  return Promise.resolve();
}

function fallbackCopy(value) {
  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  document.execCommand('copy');
  field.remove();
}

function initFan(root) {
  $$('.dcx-fan', root).forEach((fan) => {
    const panels = $$('.dcx-fan-panel', fan);
    if (!panels.length) return;

    function setActive(index) {
      fan.classList.add('is-engaged');
      panels.forEach((panel, i) => {
        panel.classList.toggle('is-active', i === index);
        panel.classList.toggle('is-neighbor', Math.abs(i - index) === 1);
      });
    }

    function clearActive() {
      fan.classList.remove('is-engaged');
      panels.forEach((panel) => panel.classList.remove('is-active', 'is-neighbor'));
    }

    fan.addEventListener('mousemove', (event) => {
      const rect = fan.getBoundingClientRect();
      const progress = Math.min(0.999, Math.max(0, (event.clientX - rect.left) / rect.width));
      let active = 0;
      panels.forEach((panel, i) => {
        const left = parseFloat(panel.style.getPropertyValue('--panel-left')) / 100;
        if (progress >= left) active = i;
      });
      setActive(active);
    });
    fan.addEventListener('mouseleave', clearActive);

    panels.forEach((panel, i) => {
      panel.addEventListener('focus', () => setActive(i));
      panel.addEventListener('blur', () => {
        if (!fan.matches(':focus-within')) clearActive();
      });
      panel.addEventListener('click', () => {
        const value = panel.dataset.copyColor;
        if (!value) return;
        copyText(value);
        const label = panel.querySelector('.dcx-fan-name');
        const original = panel.dataset.colorName || 'Color';
        panel.classList.add('is-copied');
        if (label) label.textContent = 'Copied!';
        window.clearTimeout(panel._copyTimer);
        panel._copyTimer = window.setTimeout(() => {
          panel.classList.remove('is-copied');
          if (label) label.textContent = original;
        }, 900);
      });
    });
  });
}

function buildSubnav(expander, activeId) {
  $$('.dcx-nav-list li', expander).forEach((li) => {
    const isActive = li.dataset.category === activeId;
    li.classList.toggle('is-active', isActive);
    const subnav = li.querySelector('.dcx-subnav');
    if (!subnav) return;
    subnav.innerHTML = '';
    if (!isActive) return;
    $$('.dcx-main .dcx-block[data-label]', expander).forEach((blockEl, i) => {
      const btn = document.createElement('button');
      btn.className = 'dcx-sub-link';
      btn.type = 'button';
      btn.textContent = blockEl.dataset.label.replace(/&amp;/g, '&');
      btn.setAttribute('data-dcx-subsection', String(i));
      subnav.appendChild(btn);
    });
  });
  $$('.dcx-nav-link', expander).forEach((link) => {
    if (link.dataset.dcxNav === activeId) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function scrollToBlock(expander, index) {
  const blocks = $$('.dcx-main .dcx-block[data-label]', expander);
  const target = blocks[Number(index)];
  if (!target) return;
  const main = expander.querySelector('.dcx-main');
  const top = target.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - 18;
  main.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? 'auto' : 'smooth' });
}

function renderCategory(id, expander, updateHash) {
  const template = document.getElementById(`dcx-detail-${id}`);
  if (!template) return;

  expander.querySelector('.dcx-current').textContent = names[id] || id;

  const main = expander.querySelector('.dcx-main');
  main.innerHTML = '';
  main.appendChild(template.content.cloneNode(true));
  main.scrollTop = 0;
  initFan(main);

  if (current) {
    const tile = $(`.dcx-tile--${id}`);
    current.id = id;
    current.tile = tile;
    current.rect = tile.getBoundingClientRect();
  }

  buildSubnav(expander, id);
  if (updateHash) history.pushState({ category: id }, '', `#${id}`);
}

function openCategory(id, updateHash) {
  if (!(id in names)) return;
  if (current && current.id === id) return;
  closeCategory(false);

  const tile = $(`.dcx-tile--${id}`);
  if (!tile) return;

  const rect = tile.getBoundingClientRect();
  const expander = document.createElement('section');
  expander.className = 'dcx-expander';
  expander.setAttribute('role', 'dialog');
  expander.setAttribute('aria-modal', 'true');
  expander.setAttribute('aria-label', `${names[id]} details`);
  expander.style.top = `${rect.top}px`;
  expander.style.left = `${rect.left}px`;
  expander.style.width = `${rect.width}px`;
  expander.style.height = `${rect.height}px`;

  expander.appendChild(shellTemplate.content.cloneNode(true));
  document.body.appendChild(expander);
  document.body.classList.add('is-locked');
  current = { id: null, expander, tile, rect, opener: tile };
  renderCategory(id, expander, false);
  current.id = id;

  requestAnimationFrame(() => {
    expander.classList.add('is-full');
    window.setTimeout(() => {
      expander.classList.add('is-ready');
      expander.querySelector('.dcx-close')?.focus({ preventScroll: true });
    }, READY_MS);
  });

  expander.querySelector('.dcx-close').addEventListener('click', () => closeCategory(true));

  expander.querySelector('.dcx-nav').addEventListener('click', (event) => {
    const subLink = event.target.closest('[data-dcx-subsection]');
    if (subLink) {
      scrollToBlock(expander, subLink.getAttribute('data-dcx-subsection'));
      return;
    }
    const navLink = event.target.closest('[data-dcx-nav]');
    if (!navLink) return;
    event.preventDefault();
    if (current && navLink.dataset.dcxNav === current.id) return;
    renderCategory(navLink.dataset.dcxNav, expander, true);
  });

  if (updateHash) history.pushState({ category: id }, '', `#${id}`);
}

function closeCategory(updateHash) {
  if (!current) return;
  const { expander, rect, opener } = current;
  expander.classList.remove('is-ready', 'is-full');
  expander.style.top = `${rect.top}px`;
  expander.style.left = `${rect.left}px`;
  expander.style.width = `${rect.width}px`;
  expander.style.height = `${rect.height}px`;
  window.setTimeout(() => {
    expander.remove();
    document.body.classList.remove('is-locked');
  }, MORPH_MS);
  current = null;
  if (opener) opener.focus({ preventScroll: true });
  if (updateHash && location.hash) history.pushState(null, '', location.pathname + location.search);
}

tiles.forEach((tile) => {
  tile.addEventListener('click', () => openCategory(tile.dataset.category, true));
});

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

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && revealed) closeCategory(true);
});

window.addEventListener('popstate', () => {
  if (!revealed) return;
  const id = location.hash.replace('#', '');
  if (id && id in names) {
    if (current) renderCategory(id, current.expander, false);
    else openCategory(id, false);
  } else {
    closeCategory(false);
  }
});

/* ============================================================
   Live edit session — the document as a working surface.

   The picker server forks a doc-session sibling on submit and hands
   this tab its address and token. From then on the document is
   editable through two paths:

   - Simple edits (a palette color) POST /doc/edit and the session
     applies them itself: answers.json and DESIGN.md are rewritten by
     a deterministic function, no model in the loop.
   - Anything needing judgment (fonts, freeform asks) POSTs
     /doc/request; the agent long-polls the queue, does the work, and
     replies. The tray shows each request move pending -> working ->
     done.

   The tab learns about the outside world the way live mode's browser
   does, scaled to polling: /doc/state every couple of seconds, and a
   version bump means re-fetch answers.json and re-render.
   ============================================================ */

let docSession = null;
let docVersion = 1;
let docOnline = false;
let trayRequests = [];

const tray = $('[data-dcx-tray]');
const requestModal = $('[data-dcx-request-modal]');

const docLive = () => Boolean(docSession);

function startDocSession(doc) {
  docSession = doc;
  document.body.classList.add('dcx-live');
  schedulePoll(1500);
}

async function docPost(pathname, body) {
  const response = await fetch(`${docSession.base}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: docSession.token, ...body }),
  });
  if (!response.ok) throw new Error(`${pathname} failed: ${response.status}`);
  return response.json();
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
      await adoptAnswers();
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

function refreshDocument() {
  renderDocument();
  if (current) renderCategory(current.id, current.expander, false);
}

/* ---------- Simple edits: palette colors ---------- */

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-edit-color]');
  if (!button) return;
  const input = button.parentElement.querySelector(`[data-color-input-for="${button.dataset.editColor}"]`);
  input?.click();
});

document.addEventListener('change', (event) => {
  const input = event.target.closest?.('[data-color-input-for]');
  if (!input) return;
  applyColorEdit(input.dataset.colorInputFor, input.value.toUpperCase());
});

async function applyColorEdit(role, hex) {
  const field = form.elements[`palette-${role}`];
  if (!field || field.value.toUpperCase() === hex) return;
  field.value = hex;
  refreshDocument();
  if (!docLive()) return;
  try {
    const result = await docPost('/doc/edit', { kind: 'color', role, value: hex });
    docVersion = result.version;
  } catch {
    setDocOnline(false);
    renderTray();
  }
}

/* ---------- Complex edits: the request modal ---------- */

let requestKind = 'freeform';

document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-dcx-request], [data-dcx-request-kind]');
  if (!trigger || !requestModal) return;
  requestKind = trigger.dataset.dcxRequestKind || 'freeform';
  const category = current ? names[current.id] : 'Design context';
  $('[data-dcx-request-scope]', requestModal).textContent = requestKind === 'font'
    ? 'Typography change' : `${category} change`;
  $('[data-dcx-request-fonts]', requestModal).hidden = requestKind !== 'font';
  const prompt = $('.dcx-request-prompt', requestModal);
  prompt.value = '';
  $('[data-dcx-request-upload-note]', requestModal).textContent = '';
  requestModal.showModal();
  prompt.focus();
});

$('[data-dcx-request-cancel]', requestModal)?.addEventListener('click', () => requestModal.close());

$('[data-dcx-request-send]', requestModal)?.addEventListener('click', async () => {
  const prompt = $('.dcx-request-prompt', requestModal).value.trim();
  if (!prompt || !docLive()) return;
  const send = $('[data-dcx-request-send]', requestModal);
  send.disabled = true;
  try {
    const files = $('[data-dcx-request-files]', requestModal)?.files || [];
    const uploaded = [];
    for (const file of files) {
      const response = await fetch(`${docSession.base}/font-upload?token=${encodeURIComponent(docSession.token)}`, {
        method: 'POST',
        headers: { 'X-Font-Filename': file.name },
        body: file,
      });
      if (response.ok) uploaded.push((await response.json()).path);
    }
    const result = await docPost('/doc/request', {
      kind: requestKind,
      prompt,
      category: current ? current.id : '',
      payload: uploaded.length ? { fonts: uploaded } : {},
    });
    docVersion = result.version;
    requestModal.close();
    schedulePoll(400);
  } catch {
    $('[data-dcx-request-upload-note]', requestModal).textContent = 'The edit session is unreachable; the request was not sent.';
  } finally {
    send.disabled = false;
  }
});

/* ---------- The tray ---------- */

const TRAY_LABELS = {
  pending: 'Queued for the agent',
  working: 'The agent is on it',
  done: 'Applied',
  error: 'Could not apply',
};

function renderTray() {
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
