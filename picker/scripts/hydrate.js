/** Restoring a previous run into the questionnaire.
 *
 * The one rule this file is built around: setting `.checked` or `.value` from
 * script fires no event, and every committer on this page runs off change
 * events. A bare write therefore leaves the radio saying one thing and the
 * hidden field the rest of the run reads saying another. So every answer is
 * restored by clicking its control, or by calling the function the control
 * would have called.
 *
 * The order matters too. Clicking a radio runs record(), which stamps
 * data-chosen on every field it writes, so which answers a person actually
 * visited is restored last, after every click has had its say.
 *
 * The questionnaire owns the state being restored, so palette-picker.js passes
 * the handles this needs rather than this file reaching into it.
 */

const ROLES = ['primary', 'secondary', 'tertiary', 'neutral'];

/* Groups whose answer is one radio the whole run reads. Absent keys are left
   alone: a run that was never asked about movement must come back without a
   movement key, not with a default standing in for a decision. */
const RADIO_GROUPS = [
  'color-strategy',
  'motion-energy',
  'layout-structure',
  'boundary-style',
  'corner-style',
  'depth-style',
  'type-scale',
  'icon-pack',
];

const asText = (value) => (typeof value === 'string' ? value : '');

/* Clicking is the whole point: activation runs the change handlers that commit
   the answer, which a bare `checked = true` would skip. */
function clickOption(name, value) {
  if (!value) return false;
  const input = document.querySelector(`input[name="${name}"][value="${CSS.escape(value)}"]`);
  if (!input || input.disabled) return false;
  input.click();
  return true;
}

function surfaceFields() {
  return [...document.querySelectorAll('input[type="hidden"][data-surface-field]')];
}

export function hydrateAnswers(prior, ctx) {
  if (!prior) return;

  restoreSurfaces(prior, ctx);
  for (const group of RADIO_GROUPS) {
    if (group in prior) clickOption(group, asText(prior[group]));
  }
  restoreSurfaceFields(prior);
  restorePalette(prior, ctx);
  restoreFonts(prior, ctx);
  restoreIconMeta(prior);
  restoreChosen(prior, ctx);
}

/* Which surfaces the run covers, first, because every per-surface field is
   filled with its default the moment a tile is checked. */
function restoreSurfaces(prior, ctx) {
  const raw = prior['surface-modes'];
  const wanted = new Set(Array.isArray(raw) ? raw : (asText(raw) ? [raw] : []));
  if (!wanted.size) return;
  // The same guard the agent's own hint carries: a set naming no real tile
  // would otherwise clear the run's only required answer.
  if (!ctx.modeInputs.some((input) => wanted.has(input.value))) return;
  for (const input of ctx.modeInputs) input.checked = wanted.has(input.value);
  ctx.syncModes();
}

function restoreSurfaceFields(prior) {
  for (const field of surfaceFields()) {
    const key = field.dataset.surfaceField;
    if (field.disabled || !(key in prior)) continue;
    const value = asText(prior[key]);
    if (value) field.value = value;
  }
}

/* The deck has no programmatic selection path: the committing click reads the
   card the scroller is parked on. So the card's own state is written first,
   which is also what stops a later reorder or reset from reverting the fields
   to the colors the cue was dealt with. */
function restorePalette(prior, ctx) {
  const source = asText(prior['palette-source']);
  const colors = {};
  for (const role of ROLES) {
    const hex = asText(prior[`palette-${role}`]);
    if (hex) colors[role] = hex;
  }
  if (!source && !Object.keys(colors).length) return;

  /* The fields come first, and unconditionally: the colors are the answer, the
     source is what the document names them by, and neither depends on the deck
     still being able to show the card they came from. A document reopened after
     the generation workspace was cleaned has no deck at all, and it still has a
     palette. */
  const sourceField = document.querySelector('[name="palette-source"]');
  if (sourceField && source) sourceField.value = source;
  for (const role of ROLES) {
    const field = document.querySelector(`[name="palette-${role}"]`);
    if (field && colors[role]) field.value = colors[role];
  }

  // Nothing was dealt, so there is no card to park on and nothing to repaint.
  if (!ctx.cards.length) return;

  const index = ctx.cards.findIndex((item) => item.id === source);
  const target = index === -1 ? 0 : index;
  /* Writing the card's own state is also what stops a later reorder or reset
     from reverting the fields to the colors the cue was dealt with. */
  const state = ctx.states.get(ctx.cards[target]?.id);
  if (state?.colors) Object.assign(state.colors, colors);
  ctx.setCurrent(target);
  ctx.render();
  ctx.syncDeckScroll();
}

/* A pair still on the rail is chosen by clicking it, which runs syncFontPair.
   A pair that is not, an upload or a set of faces this run was not dealt, is
   rebuilt as the custom pair and registered before its card is added: the rail
   resolves a click through the manifest, so a card the manifest does not know
   cannot be chosen a second time. */
function restoreFonts(prior, ctx) {
  const wanted = asText(prior['font-pair']);
  const heading = asText(prior['font-heading']);
  const body = asText(prior['font-body']);
  const manifest = ctx.fontManifest();

  if (wanted && wanted !== 'custom' && manifest.pairs.some(({ id }) => id === wanted)) {
    if (clickOption('font-pair', wanted)) return;
  }
  if (!heading || !body) return;

  const pair = {
    id: 'custom',
    name: 'Custom',
    heading: { family: heading, weight: 600, source: asText(prior['font-heading-source']) },
    body: { family: body, weight: 400, source: asText(prior['font-body-source']) },
    why: 'From your last run',
  };
  manifest.pairs = [pair, ...manifest.pairs.filter(({ id }) => id !== 'custom')];
  for (const node of ctx.pairNodes()) {
    if (node.querySelector('input')?.value === 'custom') ctx.removePairCard(node);
  }
  ctx.addPairCard(pair, { checked: true, first: true });
  ctx.loadCustomFace(pair);
  ctx.syncFontPair(pair);
  ctx.applyHoist({ force: true });
}

/* The pack's own radio carries the license and URL when it is still on offer;
   these are the record of one that is not. */
function restoreIconMeta(prior) {
  for (const key of ['icon-pack-name', 'icon-pack-license', 'icon-pack-url']) {
    const field = document.querySelector(`[name="${key}"]`);
    const value = asText(prior[key]);
    if (field && !field.value && value) field.value = value;
  }
}

/* Last, because every click above stamped its own. A default nobody opened and
   a default someone confirmed hold the same value, so only this list tells them
   apart, and the document says which is which. */
function restoreChosen(prior, ctx) {
  let chosen = null;
  try {
    const parsed = JSON.parse(asText(prior._chosen) || 'null');
    if (Array.isArray(parsed)) chosen = new Set(parsed);
  } catch {
    /* Written by a run that did not keep the distinction. */
  }
  for (const field of surfaceFields()) {
    const key = field.dataset.surfaceField;
    if (field.disabled) continue;
    // A run that kept no list was confirmed wholesale at submit, so every
    // answer it carries counts as visited.
    const visited = chosen ? chosen.has(key) : key in prior;
    if (visited) field.dataset.chosen = 'yes';
    else delete field.dataset.chosen;
  }
  ctx.syncChosenField();
}
