import { contrastInk, contrastInkHex, formatOklch, hexToOklch, oklchToHex, readableOn, seedToRoles } from './color.js';

const ROLES = ['primary', 'secondary', 'tertiary', 'neutral'];
const screen = document.querySelector('[data-screen="02"]');
const $ = (selector, root = screen) => root.querySelector(selector);
const $$ = (selector, root = screen) => root.querySelectorAll(selector);
const scroller = $('[data-deck-scroll]');
const points = $('[data-deck-points]');
const layer = $('[data-deck-cards]');
const count = $('[data-deck-count]');
const panel = $('.picker-palette-panel');
const hint = $('[data-palette-hint]');
const ringGuide = $('[data-ring-guide]');
const loupe = $('[data-loupe]');
const preview = $('.picker-preview');
const typePreview = document.querySelector('[data-type-preview]');
const fontOptions = document.querySelector('[data-font-options]');
const pairTemplate = document.querySelector('[data-pair-card]');
const scaleOptions = document.querySelector('[data-scale-options]');
const scaleSheet = document.querySelector('[data-scale-sheet]');
const states = new Map();
const canvases = new WeakMap();
let cards = [];
let current = 0;
let openTint;
let fontManifest;

/* Headlines and labels come from the product so the display face is judged on
   words it will really set. Running text stays lorem on purpose: a body face
   is judged on texture, and real prose pulls the eye into reading it. */
const LOREM = {
  sentence: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.',
  paragraph: 'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo.',
};

/* The desktop artboard sets three cards and the phone two, so a fourth would
   be words the agent writes and nobody ever reads. */
const GALLERY_CARDS = 3;

const FALLBACK_FONTS = {
  version: 1,
  specimen: {
    headline: 'Built for the work at hand',
  },
  preview: {
    brand: 'Ab',
    nav: ['Product', 'Pricing', 'Docs', 'About'],
    navAction: 'Sign in',
    menuAction: 'Menu',
    ctaPrimary: 'Get started',
    ctaSecondary: 'Learn more',
    proof: ['Fast to set up', 'Works anywhere', 'No lock-in', 'Free to try'],
    sectionTitle: 'Everything in one place',
    sectionLink: 'Read the guide',
    gallery: [
      { title: 'Overview', meta: 'Start here' },
      { title: 'Library', meta: 'Browse all' },
      { title: 'Reports', meta: 'See results' },
    ],
    footerLinks: ['Product', 'Company', 'Support', 'Legal'],
    footerMark: '© Your product',
  },
  pairs: [
    {
      id: 'source-editorial',
      name: 'Source editorial',
      heading: { family: 'Source Serif 4', weight: 600 },
      body: { family: 'Source Sans 3', weight: 400 },
      why: 'Considered and editorial',
    },
    {
      id: 'literary-clarity',
      name: 'Literary clarity',
      heading: { family: 'Libre Baskerville', weight: 700 },
      body: { family: 'Libre Franklin', weight: 400 },
      why: 'Bookish and plain-spoken',
    },
    {
      id: 'warm-structure',
      name: 'Warm structure',
      heading: { family: 'Bitter', weight: 600 },
      body: { family: 'Cabin', weight: 400 },
      why: 'Sturdy slab warmth',
    },
    {
      id: 'bold-utility',
      name: 'Bold utility',
      heading: { family: 'Archivo Black', weight: 400 },
      body: { family: 'Archivo', weight: 400 },
      why: 'Headlines that shout',
    },
    {
      id: 'technical-signal',
      name: 'Technical signal',
      heading: { family: 'Azeret Mono', weight: 600 },
      body: { family: 'Noto Sans', weight: 400 },
      why: 'Machined and precise',
    },
    {
      id: 'classical-poise',
      name: 'Classical poise',
      heading: { family: 'Marcellus', weight: 400 },
      body: { family: 'Karla', weight: 400 },
      why: 'Inscriptional and formal',
    },
  ],
};

const roleMap = (value) => Object.fromEntries(ROLES.map((role) => [role, value(role)]));
const card = () => cards[current];
const state = () => states.get(card().id);
const dismissRingGuide = () => ringGuide.setAttribute('aria-hidden', 'true');
const serifFamily = /serif|mincho|baskerville|bitter|marcellus|slab|antiqua|garamond|didot|bodoni/i;
const fontStack = (family) => `"${family.replaceAll('"', '\\"')}", ${serifFamily.test(family) ? 'serif' : 'sans-serif'}`;

function createState(item) {
  const colors = item.type === 'cue'
    ? roleMap((role) => (item.palette[role].snapped || item.palette[role].hex).toUpperCase())
    : seedToRoles(item);
  return {
    colors,
    detached: roleMap(() => false),
    rings: roleMap(() => [50, 50]),
  };
}

function sourceCanvas(image) {
  let canvas = canvases.get(image);
  if (canvas) return canvas;
  canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(image, 0, 0);
  canvases.set(image, canvas);
  return canvas;
}

function syncRings(item) {
  if (item.type !== 'cue') return;
  const itemState = states.get(item.id);
  $$('.picker-ring', item.node).forEach((ring) => {
    const role = ring.dataset.role;
    const [x, y] = itemState.rings[role];
    ring.style.setProperty('--x', `${x}%`);
    ring.style.setProperty('--y', `${y}%`);
    ring.style.setProperty('--marker-color', itemState.colors[role]);
    ring.setAttribute('aria-valuetext', itemState.colors[role]);
    ring.toggleAttribute('data-detached', itemState.detached[role]);
  });
}

function drawLoupe(ring, item, image) {
  const [x, y] = states.get(item.id).rings[ring.dataset.role];
  const source = sourceCanvas(image);
  const canvas = $('canvas', loupe);
  const context = canvas.getContext('2d');
  const px = x / 100 * (source.width - 1);
  const py = y / 100 * (source.height - 1);
  const crop = Math.max(8, Math.min(source.width, source.height) / 128);
  context.clearRect(0, 0, 80, 80);
  context.imageSmoothingEnabled = false;
  context.drawImage(source, px - crop / 2, py - crop / 2, crop, crop, 0, 0, 80, 80);
  const stage = loupe.parentElement.getBoundingClientRect();
  const box = ring.getBoundingClientRect();
  loupe.style.left = `${box.left - stage.left + box.width / 2}px`;
  loupe.style.top = `${box.top - stage.top}px`;
  loupe.dataset.visible = '';
}

function renderBand(role) {
  const hex = state().colors[role];
  const band = $(`[data-band="${role}"]`, panel);
  band.style.setProperty('--band-color', hex);
  band.style.setProperty('--band-ink', contrastInk(hex));
  $('output', band).textContent = hex;
  $('input', band).value = hex;
  renderPreview();
}

function renderPreview() {
  for (const role of ROLES) preview.style.setProperty(`--pv-${role}`, state().colors[role]);
  preview.style.setProperty('--pv-n-ink', contrastInk(state().colors.neutral));
}

function syncCommittedPalette(target) {
  const committed = roleMap((role) => $(`[name="palette-${role}"]`).value);
  if (!target || Object.values(committed).some((hex) => !hex)) return;
  for (const role of ROLES) target.style.setProperty(`--pv-${role}`, committed[role]);
  // One ink per fill a preview can paint a label on: the strategy decides
  // which of the three carries the button on any given artboard.
  target.style.setProperty('--pv-n-ink', contrastInk(committed.neutral));
  target.style.setProperty('--pv-p-ink', contrastInk(committed.primary));
  target.style.setProperty('--pv-t-ink', contrastInk(committed.tertiary));
  // And one reading version of each accent that the type artboards set words
  // in, per ground it can land on: the neutral page, or the primary once the
  // strategy drenches the page in it.
  target.style.setProperty('--pv-p-on-n', readableOn(committed.primary, committed.neutral));
  target.style.setProperty('--pv-t-on-n', readableOn(committed.tertiary, committed.neutral));
  target.style.setProperty('--pv-t-on-p', readableOn(committed.tertiary, committed.primary));
  // Labels on filled buttons: hue is the role that paints the fill, ground is
  // that same fill — not the page neutral that produced the 1.63:1 regression.
  target.style.setProperty('--pv-p-on-p', readableOn(committed.primary, committed.primary));
  target.style.setProperty('--pv-t-on-t', readableOn(committed.tertiary, committed.tertiary));
  target.style.setProperty('--pv-p-on-i', readableOn(committed.primary, contrastInkHex(committed.primary)));
}

/* Every field is checked only when it is present. The manifest merges over
   FALLBACK_FONTS, so a partial file is legal by design: the spec asks for the
   full set on the shared block, and a per-pair override is allowed to carry
   the one string it changes. Demanding the full shape anywhere it appears
   would reject that override and drop the whole manifest, six chosen pairs
   included, back to defaults. */
function isPreviewCopy(value) {
  if (!value || typeof value !== 'object') return false;
  const strings = ['brand', 'navAction', 'menuAction', 'ctaPrimary', 'ctaSecondary', 'sectionTitle', 'sectionLink', 'footerMark'];
  const lists = { nav: 4, proof: 4, footerLinks: 4 };
  return strings.every((key) => value[key] === undefined || typeof value[key] === 'string')
    && Object.entries(lists).every(([key, length]) => value[key] === undefined || (
      Array.isArray(value[key])
      && value[key].length === length
      && value[key].every((entry) => typeof entry === 'string')
    ))
    && (value.gallery === undefined || (
      Array.isArray(value.gallery)
      && value.gallery.length === GALLERY_CARDS
      && value.gallery.every((entry) => (
        typeof entry?.title === 'string'
        && typeof entry?.meta === 'string'
      ))
    ));
}

function normalizeFontManifest(manifest) {
  return {
    ...manifest,
    preview: { ...FALLBACK_FONTS.preview, ...manifest.preview },
  };
}

function isFontManifest(value) {
  return value?.version === 1
    && typeof value.specimen?.headline === 'string'
    && (!value.preview || isPreviewCopy(value.preview))
    && value.pairs?.length === 6
    && value.pairs.every((pair) => (
      typeof pair.id === 'string'
      && typeof pair.name === 'string'
      && typeof pair.heading?.family === 'string'
      && Number.isFinite(pair.heading?.weight)
      && typeof pair.body?.family === 'string'
      && Number.isFinite(pair.body?.weight)
      && typeof pair.why === 'string'
      && (!pair.preview || isPreviewCopy(pair.preview))
    ));
}

function loadFontStylesheet(pairs) {
  const families = new Map();
  const addWeight = (family, weight) => {
    if (!families.has(family)) families.set(family, new Set());
    families.get(family).add(weight);
  };
  for (const pair of pairs) {
    addWeight(pair.heading.family, pair.heading.weight);
    addWeight(pair.body.family, pair.body.weight);
    addWeight(pair.body.family, 700);
  }
  const query = [...families].map(([family, weights]) => {
    const name = encodeURIComponent(family).replaceAll('%20', '+');
    return `family=${name}:wght@${[...weights].sort((a, b) => a - b).join(';')}`;
  }).join('&');
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${query}&display=swap`;
  link.dataset.pickerFonts = '';
  document.head.append(link);
}

function fillIndexed(root, selector, values) {
  if (!root) return;
  root.querySelectorAll(selector).forEach((node, index) => {
    node.textContent = values[index] ?? '';
  });
}

function fillGallery(root, gallery) {
  if (!root) return;
  root.querySelectorAll('.ps-gallery-item').forEach((item, index) => {
    const title = item.querySelector('[data-type-gallery-title]');
    const meta = item.querySelector('[data-type-gallery-meta]');
    if (title) title.textContent = gallery[index]?.title ?? '';
    if (meta) meta.textContent = gallery[index]?.meta ?? '';
  });
}

function syncFontPair(pair) {
  const manifest = fontManifest;
  const preview = {
    ...FALLBACK_FONTS.preview,
    ...manifest.preview,
    ...pair.preview,
  };
  const specimen = { ...manifest.specimen, ...pair.specimen };
  const desktop = typePreview.querySelector('.ps-desktop');
  const phoneBody = typePreview.querySelector('.ps-phone-body');
  const phoneFooter = typePreview.querySelector('.ps-phone-footer');
  // The scale sheet is set in the pair chosen here, so it travels with it.
  for (const target of [typePreview, scaleSheet]) {
    target.style.setProperty('--pt-heading', fontStack(pair.heading.family));
    target.style.setProperty('--pt-body', fontStack(pair.body.family));
    target.style.setProperty('--pt-heading-weight', pair.heading.weight);
  }
  for (const node of document.querySelectorAll('[data-type-brand]')) node.textContent = preview.brand;
  fillIndexed(desktop, '[data-type-nav]', preview.nav);
  for (const node of document.querySelectorAll('[data-type-nav-action]')) node.textContent = preview.navAction;
  for (const node of document.querySelectorAll('[data-type-menu-action]')) node.textContent = preview.menuAction;
  for (const node of document.querySelectorAll('[data-type-headline]')) node.textContent = specimen.headline;
  for (const node of document.querySelectorAll('[data-type-body]')) node.textContent = LOREM.sentence;
  document.querySelectorAll('[data-type-cta-primary]').forEach((node) => {
    node.textContent = preview.ctaPrimary;
  });
  document.querySelectorAll('[data-type-cta-secondary]').forEach((node) => {
    node.textContent = preview.ctaSecondary;
  });
  fillIndexed(desktop, '[data-type-proof]', preview.proof);
  fillIndexed(phoneBody, '[data-type-proof]', preview.proof);
  document.querySelectorAll('[data-type-section-title]').forEach((node) => {
    node.textContent = preview.sectionTitle;
  });
  for (const node of document.querySelectorAll('[data-type-section-body]')) node.textContent = LOREM.paragraph;
  document.querySelectorAll('[data-type-section-link]').forEach((node) => {
    node.textContent = preview.sectionLink;
  });
  fillGallery(desktop, preview.gallery);
  fillGallery(phoneBody, preview.gallery);
  fillIndexed(desktop.querySelector('.ps-footer'), '[data-type-footer-link]', preview.footerLinks);
  fillIndexed(phoneFooter, '[data-type-footer-link]', preview.footerLinks);
  document.querySelectorAll('[data-type-footer-mark]').forEach((node) => {
    node.textContent = preview.footerMark;
  });
  document.querySelector('[name="font-heading"]').value = pair.heading.family;
  document.querySelector('[name="font-body"]').value = pair.body.family;
  document.querySelector('[name="font-heading-source"]').value = pair.heading.source || '';
  document.querySelector('[name="font-body-source"]').value = pair.body.source || '';
}

/* Where each pair belongs when it is not the chosen one. The rail renders a
   rotation of this list rather than the list itself, so hoisting the answer
   to the top never loses the order the rest were dealt in. An uploaded pair
   joins at the front: it is the one the user made. */
const pairOrder = [];

function addPairCard(pair, { checked = false, first = false } = {}) {
  const node = pairTemplate.content.firstElementChild.cloneNode(true);
  const input = node.querySelector('input');
  input.value = pair.id;
  input.checked = checked;
  input.setAttribute(
    'aria-label',
    `${pair.heading.family} for headings with ${pair.body.family} for body text. ${pair.why}`,
  );
  node.style.setProperty('--pair-heading', fontStack(pair.heading.family));
  node.style.setProperty('--pair-body', fontStack(pair.body.family));
  node.style.setProperty('--pair-heading-weight', pair.heading.weight);
  node.style.setProperty('--pair-body-weight', pair.body.weight);
  node.querySelector('[data-pair-heading]').textContent = pair.heading.family;
  node.querySelector('[data-pair-body]').textContent = pair.body.family;
  node.querySelector('[data-pair-why]').textContent = pair.why;
  if (first) pairOrder.unshift(node);
  else pairOrder.push(node);
  fontOptions.append(node);
  return node;
}

function removePairCard(node) {
  const index = pairOrder.indexOf(node);
  if (index !== -1) pairOrder.splice(index, 1);
  node.remove();
}

function renderFontPairs(manifest, fallback) {
  fontManifest = normalizeFontManifest(manifest);
  fontOptions.toggleAttribute('data-fallback', fallback);
  manifest.pairs.forEach((pair, index) => addPairCard(pair, { checked: index === 0 }));
  loadFontStylesheet(manifest.pairs);
  syncFontPair(manifest.pairs[0]);
  applyHoist();
}

fontOptions.onchange = ({ target }) => {
  if (!target.matches('input[name="font-pair"]')) return;
  const pair = fontManifest.pairs.find(({ id }) => id === target.value);
  if (pair) syncFontPair(pair);
  requestHoist();
};

/* Scroll by whole rows so an option never ends up half in frame, and disable
   an arrow at the end it points to, since a live arrow that does nothing is
   the reason the list looked unscrollable in the first place. */
function wireListScroll(list) {
  const buttons = [...list.closest('.picker-type-rail').querySelectorAll('[data-list-scroll]')];
  const sync = () => {
    const room = list.scrollHeight - list.clientHeight;
    for (const button of buttons) {
      const down = button.dataset.listScroll === '1';
      const spent = down ? list.scrollTop >= room - 1 : list.scrollTop <= 1;
      button.disabled = room < 2 || spent;
    }
  };
  for (const button of buttons) {
    button.onclick = () => {
      const step = list.querySelector('.picker-strategy-option')?.offsetHeight || 100;
      list.scrollBy({ top: step * Number(button.dataset.listScroll), behavior: 'smooth' });
    };
  }
  list.addEventListener('scroll', sync, { passive: true });
  new ResizeObserver(sync).observe(list);
  return sync;
}

const syncScrollButtons = wireListScroll(fontOptions);
wireListScroll(scaleOptions);

/* Screens where the cursor previews and the click commits need one rule for
   what the preview falls back to, and `focusout` on its own is not it. Clicking
   a row blurs whatever held focus before the browser focuses that row's input,
   and the intermediate event carries no relatedTarget, so a listener that
   trusts it shows the old answer for a frame at the exact moment the user picks
   a new one. Waiting a frame lets the pointer settle the question: still inside
   the list means the user is browsing and the preview is already right. */
function restWhenIdle(list, rest) {
  let queued;
  return () => {
    cancelAnimationFrame(queued);
    queued = requestAnimationFrame(() => {
      if (list.matches(':hover')) return;
      rest(list.contains(document.activeElement) ? document.activeElement : null);
    });
  };
}

/* The chosen pair takes the top of the rail, so the answer is the first thing
   the list shows and the rest keep their dealt order underneath it.

   The move is not made at the moment of choosing, and that is the whole
   design. Reordering under a live cursor drags the row the user just clicked
   out from under the pointer and parks a different pair where the next click
   is already aimed. Reordering on a radio group's arrow keys is worse: every
   press both moves focus and commits, so a list that re-sorts per press
   re-sorts between presses and the group cannot be crossed at all.

   So the rail reorders only while nobody is working it. A selection sets the
   request; the pointer leaving, or focus leaving, spends it. Arriving on the
   screen spends it too, which is the backstop if a settle is ever missed. */
const typeRail = fontOptions.closest('.picker-type-rail');
const RAIL_NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', ' ']);
let hoistPending = false;
let pointerInRail = false;
let keyboardInRail = false;
let hoistFlash;

/* :hover covers the one case the pointer events miss: the cursor already
   resting where the rail appears, which fires no enter of its own. */
const railBusy = () => pointerInRail
  || typeRail.matches(':hover')
  || (keyboardInRail && typeRail.contains(document.activeElement));

/* Nothing is under the cursor when the rows move, so the move itself needs no
   transition to be readable. What it needs is somewhere for the eye to land
   after it: the row that just took the top comes up bright and settles to its
   resting checked state. Color only, so the acknowledgement cannot disturb
   the list it is pointing at. */
function flashHoisted(node) {
  clearTimeout(hoistFlash);
  for (const other of pairOrder) other.removeAttribute('data-hoisted');
  // Reading a layout property between the two writes is what restarts the
  // animation on a row that is still marked from the previous hoist.
  void node.offsetWidth;
  node.dataset.hoisted = '';
  hoistFlash = setTimeout(() => node.removeAttribute('data-hoisted'), 700);
}

function applyHoist({ force = false } = {}) {
  hoistPending = false;
  const chosen = fontOptions.querySelector('input[name="font-pair"]:checked')?.closest('.picker-type-option');
  if (!chosen) return;
  const wanted = [chosen, ...pairOrder.filter((node) => node !== chosen)];
  const shown = [...fontOptions.querySelectorAll('.picker-type-option')];
  const moved = wanted.some((node, index) => node !== shown[index]);
  if (moved) {
    // Rows move as real nodes so tab order, reading order, and what is on
    // screen stay one order. Re-parenting can drop focus on the way, which
    // would strand a keyboard user outside the group they were just in.
    const focused = document.activeElement;
    for (const node of wanted) fontOptions.append(node);
    if (fontOptions.contains(focused) && document.activeElement !== focused) {
      focused.focus({ preventScroll: true });
    }
  }
  if (!moved && !force) return;
  fontOptions.scrollTo({ top: 0 });
  syncScrollButtons();
  if (moved) flashHoisted(chosen);
}

function requestHoist() {
  hoistPending = true;
  if (!railBusy()) applyHoist();
}

function settleHoist() {
  if (hoistPending && !railBusy()) applyHoist();
}

typeRail.addEventListener('pointerenter', () => {
  pointerInRail = true;
});

// A frame of slack so :hover has resolved before the guard reads it.
typeRail.addEventListener('pointerleave', () => {
  pointerInRail = false;
  requestAnimationFrame(settleHoist);
});

typeRail.addEventListener('pointerdown', () => {
  keyboardInRail = false;
});

typeRail.addEventListener('keydown', ({ key }) => {
  if (RAIL_NAV_KEYS.has(key)) keyboardInRail = true;
});

typeRail.addEventListener('focusout', ({ relatedTarget }) => {
  if (typeRail.contains(relatedTarget)) return;
  keyboardInRail = false;
  settleHoist();
});

/* Type scale.

   The numbers are the real ones: step n is 16px * ratio^n, and a Golden Ratio
   H1 really is 287px. The specimen cannot be, because 287px of "This is the
   Golden Ratio scale" is eight times the width of the sheet, and a sheet fitted
   to that H1 would set its paragraph at 2px.

   So the rendering compresses the exponent by half, which keeps every scale in
   its own character (a Minor Second sheet still reads as nearly flat, a Golden
   Ratio one as dramatic) while bringing the range from 18x down to about 4x.
   The measured fit below then scales the whole sheet if even that overflows.
   The quoted px and rem stay untouched, which is the point of showing them. */
const SCALE_BASE = 16;
const SCALE_BODY_PX = 13;
const SCALE_COMPRESSION = 0.5;
const scaleRows = [...scaleSheet.querySelectorAll('[data-scale-row]')];
const scaleRatioInput = document.querySelector('[name="type-scale-ratio"]');

const trimZeros = (value) => value.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');

/* One pass is exact: every size is linear in the fit factor, and the row boxes
   the text has to fit inside do not move when it changes. */
function fitScaleSheet() {
  scaleSheet.style.setProperty('--ts-fit', '1');
  if (!scaleSheet.clientHeight) return;
  let over = 1;
  for (const row of scaleRows) {
    const sample = row.querySelector('[data-scale-sample]');
    over = Math.max(
      over,
      sample.scrollWidth / Math.max(sample.clientWidth, 1),
      sample.scrollHeight / Math.max(row.clientHeight, 1),
    );
  }
  if (over > 1.001) scaleSheet.style.setProperty('--ts-fit', (1 / over).toFixed(4));
}

function syncTypeScale(input) {
  const ratio = Number(input.dataset.ratio);
  const name = input.dataset.scaleName;
  for (const row of scaleRows) {
    const step = Number(row.dataset.scaleRow);
    const px = SCALE_BASE * ratio ** step;
    row.style.setProperty('--ts-size', (SCALE_BODY_PX * ratio ** (step * SCALE_COMPRESSION)).toFixed(3));
    row.querySelector('[data-scale-sample]').textContent = `This is the ${name} scale`;
    row.querySelector('[data-scale-px]').textContent = `${Math.round(px)}px`;
    row.querySelector('[data-scale-rem]').textContent = `${trimZeros((px / SCALE_BASE).toFixed(2))}rem`;
  }
  scaleRatioInput.value = ratio.toFixed(3);
  fitScaleSheet();
}

scaleOptions.onchange = ({ target }) => {
  if (target.matches('input[name="type-scale"]')) syncTypeScale(target);
};

new ResizeObserver(fitScaleSheet).observe(scaleSheet);
// Every face swap changes the width of the same string, fit included.
document.fonts?.addEventListener('loadingdone', fitScaleSheet);
syncTypeScale(scaleOptions.querySelector('input:checked'));

/* Screen 11: the icon specimen. Every pack draws the same twenty-four concepts,
   so the sheet compares hands rather than catalogs. The drawings are vendored
   at build time and fetched on first arrival: eleven packs of markup is more
   than the first paint should carry for a screen most runs reach late.

   The cursor previews and the click commits, the same contract screen 03 uses
   for color strategies. What differs is that no CSS can swap a drawing, so the
   preview is painted here rather than remapped through custom properties. */
const iconOptions = document.querySelector('[data-icon-options]');
const iconSheet = document.querySelector('[data-icon-sheet]');
const iconField = iconSheet.querySelector('[data-icon-field]');
const iconStrip = iconSheet.querySelector('[data-icon-strip]');
const iconPackInputs = ['name', 'license', 'url'].map((key) => [
  key,
  document.querySelector(`[name="icon-pack-${key}"]`),
]);
let iconPacks;
let iconRequest;
let iconPainted;

wireListScroll(iconOptions);

const checkedIconPack = () => iconOptions.querySelector('input[name="icon-pack"]:checked');
const iconRowInput = (node) => node?.closest('.picker-icon-row')?.querySelector('input');

/* Packs disagree on grid size and on whether they are drawn as strokes or as
   filled paths, so the wrapper carries the pack's own viewBox and paint rather
   than one house style the drawings were never made for. */
function iconSvg(pack, glyph) {
  const attrs = Object.entries(pack.attrs)
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ');
  return `<svg viewBox="${pack.viewBox}" ${attrs} aria-hidden="true">${glyph.body}</svg>`;
}

function paintIconPack(id) {
  const pack = iconPacks?.get(id);
  if (!pack || iconPainted === id) return;
  iconPainted = id;
  delete iconField.dataset.empty;
  iconField.innerHTML = pack.glyphs
    .map((glyph) => `<span class="picker-icon-cell">${iconSvg(pack, glyph)}</span>`)
    .join('');
  iconStrip.innerHTML = pack.glyphs.map((glyph) => iconSvg(pack, glyph)).join('');
}

/* The answer carries the pack's name, license, and home page, not just its
   slug: whoever reads the answers has to credit it without looking it up. */
function commitIconPack(input) {
  for (const [key, field] of iconPackInputs) field.value = input.dataset[`pack${key[0].toUpperCase()}${key.slice(1)}`];
  paintIconPack(input.value);
}

function loadIconPacks() {
  iconRequest ??= fetch('/icon-packs.json')
    .then((response) => (response.ok ? response.json() : Promise.reject()))
    .then((data) => {
      iconPacks = new Map(data.packs.map((pack) => [pack.id, pack]));
      paintIconPack(checkedIconPack().value);
    })
    .catch(() => {
      iconField.dataset.empty = '';
      iconField.textContent = 'Icon sets could not be loaded.';
    });
  return iconRequest;
}

iconOptions.addEventListener('pointerover', (event) => {
  const input = iconRowInput(event.target);
  if (input) paintIconPack(input.value);
});
iconOptions.addEventListener('focusin', (event) => {
  const input = iconRowInput(event.target);
  if (input) paintIconPack(input.value);
});
/* With the pointer away, the keyboard is driving: the row it is on is the one
   being asked about, and only once focus has left too is the answer itself. */
const restIconPreview = restWhenIdle(iconOptions, (focused) => {
  paintIconPack(iconRowInput(focused)?.value ?? checkedIconPack().value);
});
iconOptions.addEventListener('pointerleave', restIconPreview);
iconOptions.addEventListener('focusout', restIconPreview);
iconOptions.onchange = ({ target }) => {
  if (target.matches('input[name="icon-pack"]')) commitIconPack(target);
};

commitIconPack(checkedIconPack());

/* Screen 06: the motion scene. Its three energies are told apart by amplitude
   on one shared 8s timeline, and the loudest difference between them, whether
   the page arrives or is simply there, is over inside the first fifth of it.
   A visitor who hovers a row five seconds into the loop is therefore comparing
   two energies on press depth alone, which is why hovering restarts the scene:
   the answer to "what does this one look like" is the scene from its first
   frame. CSS cannot rewind an animation, so this is the one part of the screen
   that is not a custom property.

   Only a change of energy restarts it. Sliding the pointer across a row it is
   already previewing would otherwise keep the page in a permanent entrance. */
const motionOptions = document.querySelector('[data-question="motion"] .picker-strategy-choices');
const motionScene = document.querySelector('.picker-preview-motion');
const checkedMotion = () => motionOptions.querySelector('input:checked').value;
let motionShown;

function replayMotion(energy) {
  if (energy === motionShown) return;
  motionShown = energy;
  // The hover rules resolve on their own; this only puts the timeline back to
  // its first frame, pseudo-elements and all.
  for (const animation of motionScene.getAnimations({ subtree: true })) {
    animation.cancel();
    animation.play();
  }
}

const motionRowValue = (node) => node?.closest('.picker-strategy-option')?.querySelector('input').value;

motionOptions.addEventListener('pointerover', (event) => {
  const value = motionRowValue(event.target);
  if (value) replayMotion(value);
});
motionOptions.addEventListener('focusin', (event) => {
  const value = motionRowValue(event.target);
  if (value) replayMotion(value);
});
const restMotionPreview = restWhenIdle(motionOptions, (focused) => {
  replayMotion(motionRowValue(focused) ?? checkedMotion());
});
motionOptions.addEventListener('pointerleave', restMotionPreview);
motionOptions.addEventListener('focusout', restMotionPreview);
motionOptions.addEventListener('change', ({ target }) => {
  if (target.matches('input[name="motion-energy"]')) replayMotion(target.value);
});

/* Custom fonts. A URL is carried through as-is; an uploaded face is handed to
   the server, which stores the bytes and returns the path the answers record.
   Neither is parsed here: the questionnaire validates at the end. */
const fontModal = document.querySelector('[data-font-modal]');
const customStatus = fontModal.querySelector('[data-custom-status]');
const customFile = (role) => fontModal.querySelector(`[data-custom-file="${role}"]`);
const customUrl = (role) => fontModal.querySelector(`[data-custom-url="${role}"]`);
const customSave = fontModal.querySelector('[data-font-custom-save]');
const customHint = fontModal.querySelector('[data-custom-hint]');
const FONT_SOURCE_SEP = '\n';
const FONT_FILE_EXTENSIONS = new Set(['.woff2', '.woff', '.ttf', '.otf']);
const customFilesByRole = { heading: [], body: [] };

function fontFileExtension(name) {
  const index = name.lastIndexOf('.');
  return index === -1 ? '' : name.slice(index).toLowerCase();
}

function isFontFile(file) {
  return FONT_FILE_EXTENSIONS.has(fontFileExtension(file.name));
}

function setChosenFontFiles(input, files) {
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  input.files = transfer.files;
}

function sameFontFile(a, b) {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
}

function mergeFontFiles(existing, incoming) {
  const merged = [...existing];
  for (const file of incoming) {
    if (!merged.some((entry) => sameFontFile(entry, file))) merged.push(file);
  }
  return merged;
}

function renderCustomFileList(role) {
  const list = fontModal.querySelector(`[data-custom-file-list="${role}"]`);
  const files = customFilesByRole[role];
  list.replaceChildren();
  list.hidden = files.length === 0;
  for (const file of files) {
    const item = document.createElement('li');
    item.className = 'picker-modal-file-item';
    const name = document.createElement('span');
    name.textContent = file.name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'picker-modal-file-remove';
    remove.setAttribute('aria-label', `Remove ${file.name}`);
    remove.textContent = '×';
    remove.onclick = () => {
      customFilesByRole[role] = customFilesByRole[role].filter((entry) => !sameFontFile(entry, file));
      setChosenFontFiles(customFile(role), customFilesByRole[role]);
      renderCustomFileList(role);
      syncCustomSave();
      customStatus.textContent = '';
    };
    item.append(name, remove);
    list.append(item);
  }
}

/* Either kind of source satisfies a role: a URL or at least one file. */
const roleHasSource = (role) => customFilesByRole[role].length > 0 || customUrl(role).value.trim() !== '';

/* Both roles are required. A heading-only sheet used to commit and let the
   body fall back to whichever pair happened to be selected, which is a
   substitution the user never asked for and never saw.

   The hint carries the reason. A commit that is dead with no explanation
   leaves the user clicking an inert control to find out why, so the footer
   names the role that is still open and the button is never the only
   feedback. It reads as instruction rather than correction: nothing here is
   wrong yet, the sheet is just unfinished. */
function syncCustomSave() {
  const missing = ['heading', 'body'].filter((role) => !roleHasSource(role));
  customSave.disabled = missing.length > 0;
  if (missing.length === 2) {
    customHint.textContent = 'Heading and body each need a URL or a file.';
  } else if (missing.length === 1) {
    const role = missing[0] === 'heading' ? 'Heading' : 'Body';
    customHint.textContent = `${role} still needs a URL or a file.`;
  } else {
    customHint.textContent = '';
  }
}

function parseFontSources(source) {
  if (!source) return [];
  if (source.includes(FONT_SOURCE_SEP)) return source.split(FONT_SOURCE_SEP).filter(Boolean);
  return [source];
}

document.querySelector('[data-font-custom-open]').onclick = () => {
  customStatus.textContent = '';
  for (const role of ['heading', 'body']) {
    customFilesByRole[role] = [];
    customFile(role).value = '';
    setChosenFontFiles(customFile(role), []);
    // The URL goes with the files. Clearing half the sheet leaves a field
    // holding an address whose companion upload is already gone, and the
    // commit would then read as available for work the user did last time.
    customUrl(role).value = '';
    renderCustomFileList(role);
  }
  syncCustomSave();
  fontModal.showModal();
};

document.querySelector('[data-font-custom-close]').onclick = () => fontModal.close();

for (const role of ['heading', 'body']) {
  customFile(role).onchange = ({ target }) => {
    const incoming = [...target.files].filter(isFontFile);
    if (incoming.length !== target.files.length) {
      customStatus.textContent = 'Only .woff2, .woff, .ttf, and .otf files are accepted.';
    } else {
      customStatus.textContent = '';
    }
    customFilesByRole[role] = mergeFontFiles(customFilesByRole[role], incoming);
    setChosenFontFiles(target, customFilesByRole[role]);
    target.value = '';
    renderCustomFileList(role);
    syncCustomSave();
  };
  customUrl(role).oninput = syncCustomSave;
}

async function uploadFontFile(file) {
  const response = await fetch('/font-upload', {
    method: 'POST',
    headers: { 'X-Font-Filename': file.name, 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Upload failed');
  return result.path;
}

async function resolveCustomFace(role) {
  const files = customFilesByRole[role].filter(isFontFile);
  if (files.length) {
    const paths = await Promise.all(files.map((file) => uploadFontFile(file)));
    return {
      family: files[0].name.replace(/\.[^.]+$/, ''),
      source: paths.join(FONT_SOURCE_SEP),
    };
  }
  const url = customUrl(role).value.trim();
  return url ? { family: url.split('/').pop().replace(/\.[^.]+$/, '') || 'Custom', source: url } : null;
}

customSave.onclick = async () => {
  customStatus.textContent = 'Saving…';
  let heading;
  let body;
  try {
    [heading, body] = await Promise.all([resolveCustomFace('heading'), resolveCustomFace('body')]);
  } catch (error) {
    customStatus.textContent = error.message;
    return;
  }
  // The button is already gated on both roles; this is the same rule stated
  // where the pair is built, so no path can assemble a half pair.
  if (!heading || !body) {
    customStatus.textContent = 'Add a URL or a file for both the heading and the body.';
    return;
  }
  const pair = {
    id: 'custom',
    name: 'Custom',
    heading,
    body,
    why: 'Your own faces',
  };
  fontManifest.pairs = [pair, ...fontManifest.pairs.filter(({ id }) => id !== 'custom')];
  // A second upload replaces the first rather than stacking a second row of
  // the same id, which the rail would then have to order against itself.
  for (const node of [...pairOrder]) {
    if (node.querySelector('input').value === 'custom') removePairCard(node);
  }
  addPairCard(pair, { checked: true, first: true });
  loadCustomFace(pair);
  syncFontPair(pair);
  // The dialog holds the pointer and focus, so the rail is free to reorder.
  applyHoist({ force: true });
  fontModal.close();
};

// A hosted stylesheet is linked; an uploaded file is registered as a face so
// the specimen and the artboards can render it immediately.
function loadCustomFace({ heading, body }) {
  for (const face of [heading, body]) {
    if (!face?.source) continue;
    if (/\.(css)(\?|$)/i.test(face.source) || (!face.source.includes(FONT_SOURCE_SEP) && !/\.(woff2?|ttf|otf)(\?|$)/i.test(face.source))) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = face.source;
      document.head.append(link);
      continue;
    }
    for (const entry of parseFontSources(face.source)) {
      const src = entry.startsWith('http') ? entry : `/fonts/${entry.split('/').pop()}`;
      document.fonts.add(new FontFace(face.family, `url(${src})`));
    }
    document.fonts.load(`16px "${face.family}"`);
  }
}

function setActiveRole(role) {
  if (hint.textContent === hint.dataset[role]) return;
  hint.classList.add('is-changing');
  setTimeout(() => {
    hint.textContent = hint.dataset[role];
    hint.classList.remove('is-changing');
  }, 90);
}

function setColor(role, hex, detached = true) {
  const itemState = state();
  itemState.colors[role] = hex.toUpperCase();
  itemState.detached[role] = detached;
  renderBand(role);
  syncRings(card());
  setActiveRole(role);
}

function sample(ring, item, image, x, y) {
  const saved = states.get(item.id);
  const source = sourceCanvas(image);
  const role = ring.dataset.role;
  x = Math.min(100, Math.max(0, x));
  y = Math.min(100, Math.max(0, y));
  const pixel = source.getContext('2d').getImageData(
    Math.round(x / 100 * (source.width - 1)),
    Math.round(y / 100 * (source.height - 1)),
    1,
    1,
  ).data;
  const hex = `#${[pixel[0], pixel[1], pixel[2]].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  saved.rings[role] = [x, y];
  saved.colors[role] = hex;
  saved.detached[role] = false;
  syncRings(item);
  if (item === card()) renderBand(role);
  setActiveRole(role);
  drawLoupe(ring, item, image);
}

function wireRing(ring, item, image) {
  const move = (e) => {
    const box = image.getBoundingClientRect();
    sample(ring, item, image, (e.clientX - box.left) / box.width * 100, (e.clientY - box.top) / box.height * 100);
  };
  ring.onpointerdown = (e) => {
    if (e.button !== 0) return;
    ring.focus();
    ring.setPointerCapture(e.pointerId);
    ring.dataset.dragging = '';
    move(e);
  };
  ring.onpointermove = (e) => {
    if (ring.hasPointerCapture(e.pointerId)) {
      dismissRingGuide();
      move(e);
    }
  };
  ring.onpointerup = (e) => {
    move(e);
    ring.releasePointerCapture(e.pointerId);
    delete ring.dataset.dragging;
    if (document.activeElement !== ring) delete loupe.dataset.visible;
  };
  ring.onfocus = () => image.complete && drawLoupe(ring, item, image);
  ring.onblur = () => {
    if (!('dragging' in ring.dataset)) delete loupe.dataset.visible;
  };
  ring.onkeydown = (e) => {
    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!moves[e.key]) return;
    e.preventDefault();
    dismissRingGuide();
    const step = e.shiftKey ? 5 : 1;
    const [x, y] = states.get(item.id).rings[ring.dataset.role];
    sample(ring, item, image, x + moves[e.key][0] * step, y + moves[e.key][1] * step);
  };
}

function buildCard(item) {
  const node = $(`[data-${item.type}-card]`).content.firstElementChild.cloneNode(true);
  node.dataset.id = item.id;
  const face = $('.picker-card-face', node);
  if (item.type === 'seed') {
    $$('span', face).forEach((stripe, index) => {
      stripe.style.setProperty('--seed-color', states.get(item.id).colors[ROLES[index]]);
    });
  } else {
    const image = $('img', face);
    image.alt = `Visual cue ${item.id}`;
    image.src = `/cues/${encodeURIComponent(item.id)}.png`;
    $$('.picker-ring', face).forEach((ring) => {
      const role = ring.dataset.role;
      ring.setAttribute('aria-valuetext', states.get(item.id).colors[role]);
      wireRing(ring, item, image);
    });
    image.addEventListener('load', () => {
      item.defaultRings = roleMap((role) => {
        const [x, y] = item.palette[role].at;
        return [x / image.naturalWidth * 100, y / image.naturalHeight * 100];
      });
      states.get(item.id).rings = structuredClone(item.defaultRings);
      syncRings(item);
      if (item === card()) sourceCanvas(image);
    });
  }
  item.node = node;
  return node;
}

function closeTints() {
  if (!openTint) return;
  const item = $(`[data-band-item="${openTint}"]`, panel);
  delete item.dataset.tintOpen;
  $('[data-tints]', item).hidden = true;
  openTint = null;
}

function render() {
  const active = card();
  cards.forEach(({ node }, index) => {
    const delta = index - current;
    node.dataset.pos = Math.max(-2, Math.min(2, delta));
    node.classList.toggle('is-far', Math.abs(delta) > 2);
    node.setAttribute('aria-hidden', delta !== 0);
  });
  $('[data-deck-prev]').disabled = current === 0;
  $('[data-deck-next]').disabled = current === cards.length - 1;
  count.textContent = `${current + 1} / ${cards.length}`;
  for (const role of ROLES) renderBand(role);
  syncRings(active);
  if (active.type === 'cue') {
    const image = $('img', active.node);
    if (image.complete && image.naturalWidth) sourceCanvas(image);
  }
  closeTints();
}

function browse(index) {
  const next = Math.min(cards.length - 1, Math.max(0, index));
  const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  points.children[next].scrollIntoView({ behavior, block: 'start' });
}

function deckKeys(e) {
  if (e.key === 'Escape' && openTint) {
    e.preventDefault();
    closeTints();
    return;
  }
  const delta = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
  if (!delta) return;
  if (e.target instanceof Element && e.target.closest('[role="slider"], input')) return;
  e.preventDefault();
  browse(current + delta);
}

const activate = (value) => document[value ? 'addEventListener' : 'removeEventListener']('keydown', deckKeys, true);

function openTints(role) {
  closeTints();
  openTint = role;
  setActiveRole(role);
  const item = $(`[data-band-item="${role}"]`, panel);
  const strip = $('[data-tints]', item);
  const current = state().colors[role];
  const [L, C, H] = hexToOklch(current);
  // The strip pivots on the band's color: the middle swatch is that color
  // exactly, the three to its left step toward near-white, the three to its
  // right toward near-black. Chroma eases off toward the ends so the
  // extremes stay in gamut instead of clipping to a different hue.
  $$('[data-tint]', strip).forEach((button, index) => {
    const offset = index - 3;
    const tintL = offset < 0
      ? L + (0.96 - L) * (-offset / 3)
      : L - (L - 0.16) * (offset / 3);
    const hex = offset === 0
      ? current
      : oklchToHex([tintL, C * (1 - 0.3 * (Math.abs(offset) / 3)), H]);
    button.dataset.tint = hex;
    button.style.setProperty('--tint-color', hex);
    button.setAttribute('aria-label', hex);
    button.toggleAttribute('data-current', offset === 0);
  });
  strip.hidden = false;
  item.dataset.tintOpen = '';
  $('button', strip)?.focus();
}

panel.onpointerover = panel.onfocusin = ({ target }) => {
  const band = target.closest('[data-band]');
  if (band) setActiveRole(band.dataset.band);
};
panel.oninput = ({ target }) => {
  if (target.matches('[data-color-input]')) setColor(target.dataset.colorInput, target.value);
};
panel.onclick = async (e) => {
  const data = e.target.closest('button')?.dataset;
  if (!data) return;
  if (data.copyColor) {
    const hex = state().colors[data.copyColor];
    await navigator.clipboard.writeText(`${hex}\n${formatOklch(hex)}`);
    const tip = data.tip;
    data.tip = 'Copied';
    setTimeout(() => data.tip = tip, 1200);
  } else if (data.editTints) openTints(data.editTints);
  else if (data.customColor) $(`[data-color-input="${data.customColor}"]`, panel).click();
  else if (data.tint) setColor(openTint, data.tint);
  else if ('closeTints' in data) closeTints();
  else if ('reset' in data) {
    const item = card();
    const fresh = createState(item);
    if (item.type === 'cue' && item.defaultRings) fresh.rings = structuredClone(item.defaultRings);
    states.set(item.id, fresh);
    render();
  } else if ('selectPalette' in data) {
    const item = card();
    $('[name="palette-source"]').value = item.id;
    for (const role of ROLES) $(`[name="palette-${role}"]`).value = state().colors[role];
  }
};

$('[data-deck-prev]').onclick = () => browse(current - 1);
$('[data-deck-next]').onclick = () => browse(current + 1);
scroller.addEventListener('scroll', () => {
  const height = points.firstElementChild?.offsetHeight || 1;
  const next = Math.min(cards.length - 1, Math.round(scroller.scrollTop / height));
  if (next !== current) {
    const node = card().node;
    node.dataset.exit = next > current ? 'left' : 'right';
    setTimeout(() => delete node.dataset.exit, 280);
    current = next;
    delete card().node.dataset.exit;
    render();
  }
}, { passive: true });
document.addEventListener('picker:screenchange', (event) => {
  activate(event.detail.screen === '02');
  // Every artboard on the screen being shown, whatever question it belongs to,
  // gets the committed palette. The scale sheet is deliberately not one: it is
  // picker chrome in the picker's own theme, not a page in the user's palette.
  const screenNode = document.querySelector(`.picker-screen[data-screen="${event.detail.screen}"]`);
  for (const artboard of screenNode?.querySelectorAll('[data-artboard]') ?? []) {
    syncCommittedPalette(artboard);
  }
  // Arriving is the quietest moment there is, so the rail settles here even
  // if it is already in order: the chosen pair is the row you land on.
  if (event.detail.screen === '04') {
    keyboardInRail = false;
    applyHoist({ force: true });
  }
  // A hidden screen has no animations to rewind, so the scene starts on the
  // frame after the one that revealed it, not on the frame that asked.
  if (event.detail.screen === '06') {
    requestAnimationFrame(() => {
      motionShown = null;
      replayMotion(checkedMotion());
    });
  }
  // A hidden sheet measures zero, so the fit can only be resolved on arrival.
  // The scroll waits a frame: the screen change focuses the first control after
  // this event, and that scrolls the list back to the top.
  if (event.detail.screen === '05') {
    fitScaleSheet();
    requestAnimationFrame(() => {
      scaleOptions.querySelector('input:checked')?.parentElement.scrollIntoView({ block: 'center' });
    });
  }
  // The specimen is fetched the first time the screen is asked for, and the
  // scroll waits a frame for the same reason screen 05's does.
  if (event.detail.screen === '11') {
    void loadIconPacks();
    requestAnimationFrame(() => {
      checkedIconPack()?.parentElement.scrollIntoView({ block: 'center' });
    });
  }
});

try {
  const get = (url) => fetch(url).then((response) => response.ok ? response.json() : Promise.reject());
  const [cueData, seedData] = await Promise.all([get('/cues.json'), get('/palettes.json')]);
  cards = [
    ...cueData.cues.map((id) => ({ id, type: 'cue', palette: cueData.palette[id] })),
    ...seedData.seeds.map((seed) => ({ ...seed, type: 'seed' })),
  ];
  for (const item of cards) states.set(item.id, createState(item));
  layer.append(...cards.map(buildCard));
  points.innerHTML = '<div class="picker-snap-point"></div>'.repeat(cards.length);
  $('[data-select-palette]').disabled = false;
  render();
  activate(screen.hasAttribute('data-active'));
} catch {
  count.textContent = 'Palette sources could not be loaded.';
}

let manifest = FALLBACK_FONTS;
let usingFallback = true;
try {
  const response = await fetch('/fonts.json');
  const candidate = response.ok ? await response.json() : null;
  if (isFontManifest(candidate)) {
    manifest = normalizeFontManifest(candidate);
    usingFallback = false;
  }
} catch {
  // The built-in pairs keep older and incomplete runs moving.
}
renderFontPairs(manifest, usingFallback);
