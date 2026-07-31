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
let preview = $('.picker-preview');
const typeStage = document.querySelector('[data-type-stage]');
const typeBoards = [...document.querySelectorAll('[data-type-preview]')];
const fontOptions = document.querySelector('[data-font-options]');
const pairTemplate = document.querySelector('[data-pair-card]');
const scaleOptions = document.querySelector('[data-scale-options]');
const scaleSheet = document.querySelector('[data-scale-sheet]');
const scaleSpecimen = document.querySelector('[data-scale-specimen]');
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
  /* Two of them rather than one long one, because what the Read board has to
     show is the texture of a block and the step between blocks, and a single
     paragraph shows only the first. Their length is what the widest-setting
     pair leaves room for at the smallest frame the card is drawn at. */
  passages: [
    'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur sint occaecat cupidatat.',
    'Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione.',
  ],
  note: 'Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque.',
  /* Short enough to set on one line at the handset's measure, so a list item
     stays a list item there instead of becoming a third paragraph. */
  items: [
    'Excepteur sint occaecat',
    'Non proident, sunt in culpa',
  ],
  caption: 'Lorem ipsum dolor sit amet, consectetur adipiscing.',
};

/* Every word slot on the font boards, in lorem. A pair is judged on glyphs, and
   product words pull the eye into reading the page instead of the setting, so
   the type screen draws placeholder copy in every slot rather than only in the
   running text. Titles are one word because the slot is one line wide. */
const LOREM_PREVIEW = {
  brand: 'Lo',
  nav: ['Lorem', 'Ipsum', 'Dolor', 'Amet'],
  navAction: 'Consectetur',
  menuAction: 'Ipsum',
  ctaPrimary: 'Lorem ipsum',
  ctaSecondary: 'Dolor sit',
  proof: ['Lorem ipsum dolor', 'Sit amet elit', 'Sed do eiusmod', 'Tempor incididunt'],
  sectionTitle: 'Lorem ipsum dolor sit',
  sectionLink: 'Consectetur adipiscing',
  gallery: [
    { title: 'Lorem', meta: 'Ipsum dolor' },
    { title: 'Dolor', meta: 'Sit amet' },
    { title: 'Eiusmod', meta: 'Tempor elit' },
  ],
  footerLinks: ['Lorem', 'Ipsum', 'Dolor', 'Amet'],
  footerMark: '© Lorem ipsum',
};

const LOREM_SPECIMEN = { headline: 'Lorem ipsum dolor sit amet' };

const LOREM_APP = {
  rail: ['Lorem', 'Ipsum', 'Dolor'],
  columns: ['Lorem', 'Ipsum', 'Dolor'],
  figures: ['1,284', '98.2%', '41'],
  amounts: ['$12,400', '$3,860', '$9,215'],
  panel: ['Lorem ipsum', 'Dolor sit amet'],
  switches: ['Lorem ipsum', 'Dolor sit'],
  chartTitle: 'Lorem ipsum dolor',
  lanes: ['Lorem', 'Ipsum', 'Dolor', 'Amet', 'Elit'],
};

const LOREM_DOCS = {
  rail: ['Lorem ipsum', 'Dolor', 'Consectetur', 'Adipiscing elit'],
  crumb: 'Lorem / Ipsum dolor',
  note: 'Nota',
};

const LOREM_INDEX = {
  stops: ['Lorem', 'Ipsum', 'Dolor', 'Amet'],
};

/* The desktop artboard sets three cards and the phone two, so a fourth would
   be words the agent writes and nobody ever reads. */
const GALLERY_CARDS = 3;

/* The words an interface supplies rather than the product: a tool's own rail,
   the headings over its columns, the figures under them, and the two rows of a
   settings panel. Kept here beside LOREM and for the same reason. What this
   board has to prove is that the pair draws lining numerals that hold a column
   and a semibold label that stays inside one, and both are properties of the
   face. A column is also the tightest slot on any of the boards, so its words
   cannot be left to whatever the run happens to be selling. */
const APP = {
  rail: ['Overview', 'Reports', 'Settings'],
  columns: ['Item', 'Status', 'Amount'],
  figures: ['1,284', '98.2%', '41'],
  amounts: ['$12,400', '$3,860', '$9,215'],
  panel: ['Preferences', 'Last 30 days'],
  switches: ['Email digest', 'Compact rows'],
  chartTitle: 'Volume by channel',
  /* One word each, because the label under a bar has the bar's own width and
     nothing more: a category that wraps or truncates here is a fault in the
     drawing rather than a report on the pair. The handset takes the first
     three, which is why the widest of them comes early. */
  lanes: ['Direct', 'Search', 'Social', 'Email', 'Other'],
};

/* The same argument as APP, for the surface where the words belong to the
   document rather than to the product. The rail lists sections of one page and
   the crumb says where that page sits, neither of which the manifest's nav can
   stand in for without the board reading as the same four words twice. */
const DOCS = {
  rail: ['Getting started', 'Install', 'Configuration', 'API reference'],
  crumb: 'Docs / Getting started',
  note: 'Note',
};

/* Same again for the index. The carousel's stops name parts of a body of work,
   so the footer's links cannot stand in for them: the two lists sit a band
   apart on the same board and would read as one list printed twice. */
const INDEX = {
  stops: ['Selected', 'Archive', 'Studio', 'Contact'],
};

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
  // The preview is swapped for the chosen mode's variant before the deck is
  // dealt, so this runs at least once with no card to read a color off.
  if (!cards.length) return;
  for (const role of ROLES) preview.style.setProperty(`--pv-${role}`, state().colors[role]);
  preview.style.setProperty('--pv-n-ink', contrastInk(state().colors.neutral));
}

/* The prefix exists for the strategy stage, which needs the committed colors
   under names its own CSS never rewrites: the remap there reads these to know
   what was chosen, and reading the live --pv-* would read its own output. */
function syncCommittedPalette(target, prefix = 'pv') {
  const committed = roleMap((role) => $(`[name="palette-${role}"]`).value);
  if (!target || Object.values(committed).some((hex) => !hex)) return;
  const set = (name, value) => target.style.setProperty(`--${prefix}-${name}`, value);
  for (const role of ROLES) set(role, committed[role]);
  // One ink per fill a preview can paint a label on: the strategy decides
  // which of the three carries the button on any given artboard.
  set('n-ink', contrastInk(committed.neutral));
  set('p-ink', contrastInk(committed.primary));
  set('t-ink', contrastInk(committed.tertiary));
  // And one reading version of each accent that the type artboards set words
  // in, per ground it can land on: the neutral page, or the primary once the
  // strategy drenches the page in it.
  set('p-on-n', readableOn(committed.primary, committed.neutral));
  set('t-on-n', readableOn(committed.tertiary, committed.neutral));
  set('t-on-p', readableOn(committed.tertiary, committed.primary));
  // Labels on filled buttons: hue is the role that paints the fill, ground is
  // that same fill, not the page neutral that produced the 1.63:1 regression.
  set('p-on-p', readableOn(committed.primary, committed.primary));
  set('t-on-t', readableOn(committed.tertiary, committed.tertiary));
  set('p-on-i', readableOn(committed.primary, contrastInkHex(committed.primary)));
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

/* A board takes the slots its surface has and stops, so a list longer than the
   slots is ordinary. The other direction is a fault in the markup, and it is
   left blank here rather than hidden: a hidden slot would leave the board
   drawing one item fewer than the composition its grid was measured at, and
   the blank is what makes the miscount visible. */
function fillIndexed(root, selector, values) {
  if (!root) return;
  root.querySelectorAll(selector).forEach((node, index) => {
    node.textContent = values[index] ?? '';
  });
}

/* One board's worth of copy. Every board is filled through the same hooks, so
   a slot means the same thing wherever it appears: [data-type-gallery-title]
   names an item whether the item is a card, a table row, or a piece of work,
   and a board takes the slots its surface has and leaves the rest alone. The
   desktop and the phone are filled separately because the indexed slots start
   counting again on each. */
function fillBoard(board) {
  const preview = LOREM_PREVIEW;
  const specimen = LOREM_SPECIMEN;
  const desktop = board.querySelector('.ps-desktop');
  const phoneBody = board.querySelector('.ps-phone-body');
  // A rail means the sections of a document on one board and the areas of a
  // tool on the other, so it is the one slot whose words the surface decides.
  const rail = board.dataset.surface === 'read' ? LOREM_DOCS.rail : LOREM_APP.rail;
  const fill = (selector, value) => {
    for (const node of board.querySelectorAll(selector)) node.textContent = value;
  };
  fill('[data-type-brand]', preview.brand);
  fill('[data-type-nav-action]', preview.navAction);
  fill('[data-type-menu-action]', preview.menuAction);
  fill('[data-type-headline]', specimen.headline);
  fill('[data-type-body]', LOREM.sentence);
  fill('[data-type-cta-primary]', preview.ctaPrimary);
  fill('[data-type-cta-secondary]', preview.ctaSecondary);
  fill('[data-type-section-title]', preview.sectionTitle);
  fill('[data-type-section-body]', LOREM.paragraph);
  fill('[data-type-section-link]', preview.sectionLink);
  fill('[data-type-footer-mark]', preview.footerMark);
  fill('[data-type-note-label]', LOREM_DOCS.note);
  fill('[data-type-note-body]', LOREM.note);
  fill('[data-type-crumb]', LOREM_DOCS.crumb);
  fill('[data-type-caption]', LOREM.caption);
  fill('[data-type-chart-title]', LOREM_APP.chartTitle);
  for (const card of [desktop, phoneBody]) {
    fillIndexed(card, '[data-type-nav]', preview.nav);
    fillIndexed(card, '[data-type-proof]', preview.proof);
    fillIndexed(card, '[data-type-gallery-title]', preview.gallery.map(({ title }) => title));
    fillIndexed(card, '[data-type-gallery-meta]', preview.gallery.map(({ meta }) => meta));
    fillIndexed(card, '[data-type-passage]', LOREM.passages);
    fillIndexed(card, '[data-type-item]', LOREM.items);
    fillIndexed(card, '[data-type-stop]', LOREM_INDEX.stops);
    fillIndexed(card, '[data-type-rail]', rail);
    fillIndexed(card, '[data-type-lane]', LOREM_APP.lanes);
    fillIndexed(card, '[data-type-column]', LOREM_APP.columns);
    fillIndexed(card, '[data-type-figure]', LOREM_APP.figures);
    fillIndexed(card, '[data-type-amount]', LOREM_APP.amounts);
    fillIndexed(card, '[data-type-panel]', LOREM_APP.panel);
    fillIndexed(card, '[data-type-switch]', LOREM_APP.switches);
  }
  fillIndexed(desktop?.querySelector('.ps-footer'), '[data-type-footer-link]', preview.footerLinks);
}

function syncFontPair(pair) {
  // Written once on the stage the boards share, and on screen 05's two preview
  // columns, which are set in the pair chosen here so the faces travel with it.
  for (const target of [typeStage, scaleSheet, scaleSpecimen]) {
    target.style.setProperty('--pt-heading', fontStack(pair.heading.family));
    target.style.setProperty('--pt-body', fontStack(pair.body.family));
    target.style.setProperty('--pt-heading-weight', pair.heading.weight);
  }
  for (const board of typeBoards) fillBoard(board);
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
  // The tab strip was built before the run had a pair to name, so it is told
  // once the rows exist.
  syncSurfaces();
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
   the reason the list looked unscrollable in the first place.

   Screen 05's specimen wears this too, and it has no rows: a page of prose is
   paged by most of its own frame instead, which leaves a couple of lines of
   overlap so the reader can find where they were. */
function wireListScroll(list) {
  const buttons = [...list.closest('.picker-type-rail, .picker-scale-column').querySelectorAll('[data-list-scroll]')];
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
      const step = list.querySelector('.picker-strategy-option')?.offsetHeight
        || Math.round(list.clientHeight * 0.82);
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

/* Disabled: the reorder pulled the row the user had just clicked away from
   where they left it, which reads as the list moving on its own. The rail now
   keeps the order the pairs were dealt in and the checked state alone says
   which one is chosen. */
function requestHoist() {
  hoistPending = false;
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
   H1 really is 287px. The specimen cannot be, because 287px of "Golden Ratio"
   is three times the width of the sheet, and a sheet fitted to that H1 would
   set its paragraph at 2px.

   So the rendering compresses the exponent by half, which keeps every scale in
   its own character (a Minor Second sheet still reads as nearly flat, a Golden
   Ratio one as dramatic) while bringing the range from 18x down to about 4x.
   The measured fit below then scales the whole sheet if even that overflows.
   The quoted px and rem stay untouched, which is the point of showing them.

   Both preview columns are set from these sizes. The sheet takes the measured
   fit on top of them, because seven rows have to hold inside a box that cannot
   grow; the reading column scrolls instead, so it sets the step values as they
   come. That is the only place the two columns differ.

   The sheet's sample is the scale's name and nothing more. A sentence there was
   costing the sheet its size: the longest name inside "This is the ... scale"
   ran to twice the width of a column shared three ways, so the fit halved every
   step to hold it, and the scale with the longest name came out flatter than
   the one below it. Running text belongs to the specimen column now. */
const SCALE_BASE = 16;
const SCALE_BODY_PX = 13;
const SCALE_COMPRESSION = 0.5;
const scaleRows = [...scaleSheet.querySelectorAll('[data-scale-row]')];
const scaleRatioInput = document.querySelector('[name="type-scale-ratio"]');
const checkedScale = () => scaleOptions.querySelector('input[name="type-scale"]:checked');
const scaleRowInput = (node) => node?.closest('.picker-strategy-option')?.querySelector('input');

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

function drawTypeScale(input) {
  const ratio = Number(input.dataset.ratio);
  const name = input.dataset.scaleName;
  for (const row of scaleRows) {
    const step = Number(row.dataset.scaleRow);
    const px = SCALE_BASE * ratio ** step;
    const rendered = (SCALE_BODY_PX * ratio ** (step * SCALE_COMPRESSION)).toFixed(3);
    row.style.setProperty('--ts-size', rendered);
    scaleSpecimen.style.setProperty(`--ts-step-${step}`, rendered);
    row.querySelector('[data-scale-sample]').textContent = name;
    row.querySelector('[data-scale-px]').textContent = `${Math.round(px)}px`;
    row.querySelector('[data-scale-rem]').textContent = `${trimZeros((px / SCALE_BASE).toFixed(2))}rem`;
  }
  fitScaleSheet();
}

/* The cursor previews and the click commits, the contract screens 03 and 11
   already use. Drawing is everything the two columns show; committing is the
   one line that records an answer, so a browsed row cannot leave one behind. */
function commitTypeScale(input) {
  drawTypeScale(input);
  scaleRatioInput.value = Number(input.dataset.ratio).toFixed(3);
}

scaleOptions.addEventListener('pointerover', (event) => {
  const input = scaleRowInput(event.target);
  if (input) drawTypeScale(input);
});
scaleOptions.addEventListener('focusin', (event) => {
  const input = scaleRowInput(event.target);
  if (input) drawTypeScale(input);
});
const restScalePreview = restWhenIdle(scaleOptions, (focused) => {
  drawTypeScale(scaleRowInput(focused) ?? checkedScale());
});
scaleOptions.addEventListener('pointerleave', restScalePreview);
scaleOptions.addEventListener('focusout', restScalePreview);
scaleOptions.onchange = ({ target }) => {
  if (target.matches('input[name="type-scale"]')) commitTypeScale(target);
};

const syncSpecimenScroll = wireListScroll(scaleSpecimen);

new ResizeObserver(fitScaleSheet).observe(scaleSheet);
// Every face swap changes the width of the same string, fit included.
document.fonts?.addEventListener('loadingdone', fitScaleSheet);
commitTypeScale(checkedScale());

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
// One board per surface the question is put to. All of them are mounted and one
// is shown, so the replay covers every board rather than the visible one: a
// hidden board's timeline is cancelled by its own display: none and starts over
// when its tab is opened, and the two must not disagree about which frame is
// first.
const motionScenes = [...document.querySelectorAll('.picker-preview-motion')];
const checkedMotion = () => motionOptions.querySelector('input:checked').value;
let motionShown;

function replayMotion(energy) {
  if (energy === motionShown) return;
  motionShown = energy;
  // The hover rules resolve on their own; this only puts the timeline back to
  // its first frame, pseudo-elements and all.
  for (const scene of motionScenes) {
    for (const animation of scene.getAnimations({ subtree: true })) {
      animation.cancel();
      animation.play();
    }
  }
}

/* Every scene's pointer route is written in container units, but the elements
   it visits space themselves in fixed pixels, so where a given one sits as a
   fraction of the frame changes with the frame's size. The route is measured
   off the live layout instead: one custom property per stop, re-resolved
   whenever the frame resizes, so the pointer lands on the element that
   reacts at every viewport.

   The stops a board does not have are simply not set, which is what lets one
   table serve both boards: the landing page's scenes visit its buttons and
   cards, the portfolio's visit its plates and its carousel arrow, and neither
   keyframe list names a property its own board cannot measure. */
const MOTION_STOPS = {
  '--mtr-nav1': '.ps-nav-bars i:nth-child(1)',
  '--mtr-nav2': '.ps-nav-bars i:nth-child(2)',
  '--mtr-cta1': '.ps-actions i:first-child',
  '--mtr-cta2': '.ps-actions i:last-child',
  '--mtr-card1': '.ps-gallery-item:nth-child(1) > i',
  '--mxi-work1': '.ps-index-row:nth-of-type(1) > .ps-image',
  '--mxi-work2': '.ps-index-row:nth-of-type(2) > .ps-image',
  '--mxi-rail': '.ps-index-arrow--next',
};

function plotMotionRoute(scene = null) {
  for (const board of scene ? [scene] : motionScenes) {
    const desk = board.querySelector('.ps-desktop');
    if (!desk?.clientWidth) continue;
    // Summed up the offsetParent chain rather than read once: an element's
    // offsets are relative to its nearest positioned ancestor, which for the
    // buttons is not the frame.
    const center = (el) => {
      let x = el.offsetWidth / 2;
      let y = el.offsetHeight / 2;
      for (let node = el; node && node !== desk; node = node.offsetParent) {
        x += node.offsetLeft;
        y += node.offsetTop;
      }
      return { x: (x / desk.clientWidth) * 100, y: (y / desk.clientHeight) * 100 };
    };
    for (const [name, selector] of Object.entries(MOTION_STOPS)) {
      const el = desk.querySelector(selector);
      if (!el) continue;
      const c = center(el);
      board.style.setProperty(name, `${c.x.toFixed(2)}cqw ${c.y.toFixed(2)}cqh`);
    }
    // The entry and exit point: straight above the first nav item, off-frame.
    const nav1 = desk.querySelector('.ps-nav-bars i:nth-child(1)');
    board.style.setProperty('--mtr-entry', `${center(nav1).x.toFixed(2)}cqw -8cqh`);
  }
}

for (const scene of motionScenes) {
  new ResizeObserver(() => plotMotionRoute(scene)).observe(scene.querySelector('.ps-desktop'));
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
  const role = openTint;
  const item = $(`[data-band-item="${role}"]`, panel);
  const strip = $('[data-tints]', item);
  // Focus cannot stay on a button that is about to be hidden, and the control
  // that opened the strip is the one the user is back to deciding about.
  const held = strip.contains(document.activeElement);
  delete item.dataset.tintOpen;
  strip.hidden = true;
  openTint = null;
  const toggle = $(`[data-edit-tints="${role}"]`, panel);
  toggle.setAttribute('aria-expanded', 'false');
  toggle.dataset.tip = 'Edit tints';
  if (held) toggle.focus();
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
  // A band held by the keyboard owns the arrows until it is dropped.
  if (drag?.keyboard) return;
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
  const toggle = $(`[data-edit-tints="${role}"]`, panel);
  toggle.setAttribute('aria-expanded', 'true');
  toggle.dataset.tip = 'Close tints';
  $('button', strip)?.focus();
}

/* Reordering the palette.

   The four slots keep their roles. Their labels sit in the feet and hold still;
   what a drag carries is the color, so dropping the neutral band in second
   place is what makes that color the secondary.

   The bands travel and the feet do not, which is also what makes the swap
   invisible. When a band lands, every slot on screen is already showing the
   color it is about to be given, so the colors can be rearranged and the
   transforms dropped in the same frame with nothing to see.

   Pointer events rather than HTML5 drag and drop: the native API cannot be
   animated and behaves badly by touch. */
const REORDER_MS = 220;
const LIFT_SCALE = 1.02;
const EASE = getComputedStyle(document.documentElement).getPropertyValue('--ks-ease').trim() || 'ease';
const REORDER_KEYS = new Set([' ', 'Enter', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape']);
const moves = new WeakMap();
// The editable strip on the palette screen, and its reading copy under the
// strategy screen's choices. Which one a drag started in decides how far the
// result has to be carried.
const paletteBands = $('.picker-bands', panel);
const strategyBands = document.querySelector('[data-band-scope="strategy"]');
const strategyGrid = document.querySelector('.picker-screen[data-screen="03"] .picker-strategy-grid');
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const bandNodes = (scope) => ROLES.map((role) => $(`[data-band="${role}"]`, scope));
const gripNodes = (scope) => ROLES.map((role) => $(`[data-grip="${role}"]`, scope));
const roleLabel = (index, scope) => $(`[data-band-item="${ROLES[index]}"] .picker-band-foot h2`, scope).textContent;
const announceReorder = (scope, message) => {
  const status = $('[data-reorder-status]', scope.closest('.picker-screen') ?? scope);
  if (status) status.textContent = message;
};
let drag = null;
let landing = null;

/* Which band stands in which slot while the lifted one is headed for `to`:
   the entry at slot n is the index of the band that belongs there. */
function slotOrder(from, to) {
  const order = ROLES.map((_, index) => index);
  order.splice(to, 0, ...order.splice(from, 1));
  return order;
}

/* FLIP: the node is put where it belongs first and then played back from where
   it was, so nothing downstream ever measures a half-finished position. */
function travel(node, previous, offset, animate) {
  node.style.transform = offset ? `translateX(${offset}px)` : '';
  moves.get(node)?.cancel();
  if (!animate) return;
  moves.set(node, node.animate(
    [{ transform: `translateX(${previous}px)` }, { transform: `translateX(${offset}px)` }],
    { duration: REORDER_MS, easing: EASE },
  ));
}

function lift(offset, animate) {
  const node = drag.nodes[drag.from];
  const previous = drag.offsets[drag.from];
  const at = (value) => `translateX(${value}px) scale(${LIFT_SCALE})`;
  drag.offsets[drag.from] = offset;
  node.style.transform = at(offset);
  moves.get(node)?.cancel();
  if (!animate) return;
  moves.set(node, node.animate(
    [{ transform: at(previous) }, { transform: at(offset) }],
    { duration: REORDER_MS, easing: EASE },
  ));
}

function openGap(to, animate) {
  slotOrder(drag.from, to).forEach((index, slot) => {
    if (index === drag.from) return;
    const offset = drag.homes[slot].left - drag.homes[index].left;
    if (offset === drag.offsets[index]) return;
    travel(drag.nodes[index], drag.offsets[index], offset, animate);
    drag.offsets[index] = offset;
  });
  drag.to = to;
}

function nearestSlot(shift) {
  const { homes, from } = drag;
  const center = homes[from].left + homes[from].width / 2 + shift;
  const away = (index) => Math.abs(homes[index].left + homes[index].width / 2 - center);
  return homes.reduce((best, home, index) => (away(index) < away(best) ? index : best), 0);
}

/* The rearranged palette goes back through the same path a reset takes: the
   card's saved colors are rewritten and the screen is rendered from them, so
   the readouts, the rings, the preview, and the values the select button copies
   into the form all still come off one source. */
function commitOrder(from, to, scope) {
  const saved = state();
  const colors = {};
  const detached = {};
  const rings = {};
  slotOrder(from, to).forEach((index, slot) => {
    const role = ROLES[slot];
    const source = ROLES[index];
    colors[role] = saved.colors[source];
    detached[role] = saved.detached[source];
    // The ring that sampled the color travels with it, so no marker is left
    // sitting on a pixel it no longer matches.
    rings[role] = saved.rings[source];
  });
  Object.assign(saved, { colors, detached, rings });
  render();
  // `render` reaches the palette screen, which draws itself from the deck. The
  // rest of the run reads the palette out of the committed fields instead, so a
  // reorder made on the strategy screen has to rewrite those too or it would
  // last exactly as long as the screen it happened on.
  if (scope !== paletteBands) recommitPalette();
}

/* The fields the select button writes, rewritten from the state the bands were
   just rearranged into, and everything that reads them repainted. Silent before
   a palette has been chosen: there is nothing to keep in step yet. */
function recommitPalette() {
  if (!$('[name="palette-source"]').value) return;
  for (const role of ROLES) $(`[name="palette-${role}"]`).value = state().colors[role];
  paintStrategyBands();
  paintStage();
  for (const artboard of document.querySelectorAll('.picker-screen[data-active] [data-artboard]')) {
    syncCommittedPalette(artboard);
  }
}

/* The strategy screen's band is a reading of the committed palette rather than
   of the deck, which is also what makes it correct after a reorder on either
   screen: both end in the fields this paints from. */
function paintStrategyBands() {
  const committed = roleMap((role) => $(`[name="palette-${role}"]`).value);
  if (Object.values(committed).some((hex) => !hex)) return;
  for (const role of ROLES) {
    const band = $(`[data-band="${role}"]`, strategyBands);
    band.style.setProperty('--band-color', committed[role]);
    band.style.setProperty('--band-ink', contrastInk(committed[role]));
    $('output', band).textContent = committed[role];
  }
}

/* Everything screen 03 spends on something other than the answer: the block's
   own padding, the question over the grid, and the gap between them. The grid
   caps itself against what is left, so this is the number that decides whether
   the screen fits the window.

   Measured as the difference between the block and the grid inside it rather
   than added up from the parts, because the parts are not knowable from here:
   the question is one or two lines at a size that tracks the window's width. It
   comes to between 259 and 312px across the laptop range. The literal in the
   rule was 250, short by 9 to 62, and the screen paid the difference by running
   past the fold. Nothing here reads the grid's height back into itself, so the
   value settles on the first pass. */
function fitStrategyColumn() {
  const block = strategyGrid?.parentElement;
  if (!block || !block.offsetParent) return;
  const chrome = `${Math.ceil(
    block.getBoundingClientRect().height - strategyGrid.getBoundingClientRect().height,
  )}px`;
  // Writing an unchanged value would still be a style change, and the resize it
  // provokes is what turns a settling measurement into a loop.
  if (block.style.getPropertyValue('--pk-chrome') === chrome) return;
  block.style.setProperty('--pk-chrome', chrome);
}

/* The block's height is the only thing that can move what sits above the grid,
   so it is what is watched: a question that reflowed to a second line and a
   window that moved the padding clamp both arrive here. */
if (strategyGrid) new ResizeObserver(fitStrategyColumn).observe(strategyGrid.parentElement);

function reorderedSummary(from, to) {
  const { colors } = state();
  return slotOrder(from, to)
    .map((index, slot) => `${ROLES[slot]} ${colors[ROLES[index]]}`)
    .join(', ');
}

function beginDrag(index, keyboard, scope) {
  // A second grab with one still in the air puts the first back first, so no
  // measurement is taken off a row that is standing somewhere temporary.
  if (drag) endDrag(true);
  landing?.();
  closeTints();
  const nodes = bandNodes(scope);
  for (const node of nodes) {
    moves.get(node)?.cancel();
    node.style.transform = '';
  }
  drag = {
    from: index,
    to: index,
    keyboard,
    scope,
    nodes,
    grips: gripNodes(scope),
    homes: nodes.map((node) => node.getBoundingClientRect()),
    offsets: ROLES.map(() => 0),
    id: card().id,
    pointerId: null,
    startX: 0,
  };
  nodes[index].dataset.dragging = '';
  drag.grips[index].dataset.dragging = '';
  lift(0, false);
}

function endDrag(cancel, after) {
  const { nodes, grips, from, to, homes, id, scope } = drag;
  const target = cancel ? 0 : homes[to].left - homes[from].left;
  if (cancel) openGap(from, !reduceMotion());
  drag = null;
  delete nodes[from].dataset.dragging;
  delete grips[from].dataset.dragging;
  landing = () => {
    landing = null;
    // The deck can be browsed under a drag, and another card's colors are not
    // the ones that were picked up.
    if (!cancel && to !== from && card().id === id) commitOrder(from, to, scope);
    for (const node of nodes) {
      moves.get(node)?.cancel();
      node.style.transform = '';
    }
    after?.();
  };
  if (reduceMotion()) {
    landing();
    return;
  }
  const node = nodes[from];
  const start = node.style.transform;
  const end = `translateX(${target}px) scale(1)`;
  node.style.transform = end;
  const animation = node.animate(
    [{ transform: start }, { transform: end }],
    { duration: REORDER_MS, easing: EASE },
  );
  moves.set(node, animation);
  animation.finished.then(() => landing?.(), () => {});
}

function finishDrag(keyboard) {
  const { from, to, scope } = drag;
  if (to === from) {
    endDrag(true);
    return;
  }
  const summary = `Palette reordered. ${reorderedSummary(from, to)}`;
  // Focus follows the color rather than the slot it left, and only once the
  // band has landed: a focus ring drawn on a band in flight points at nothing.
  endDrag(false, keyboard ? () => gripNodes(scope)[to].focus() : null);
  announceReorder(scope, summary);
}

const gripOf = (target) => (target instanceof Element ? target.closest('[data-grip]') : null);
const scopeOf = (grip) => grip.closest('.picker-bands');

/* Both strips reorder, and they reorder the same palette. The handlers are
   written once against whichever strip the grip that was grabbed belongs to. */
function wireReorder(root) {
  root.addEventListener('pointerdown', (event) => {
    const grip = gripOf(event.target);
    if (!grip || event.button !== 0 || !cards.length) return;
    // Keeps the press off the focus ring and out of a text selection. The grip is
    // reached by keyboard through Tab, and the pointer drag needs neither.
    event.preventDefault();
    beginDrag(ROLES.indexOf(grip.dataset.grip), false, scopeOf(grip));
    drag.pointerId = event.pointerId;
    drag.startX = event.clientX;
    grip.setPointerCapture(event.pointerId);
  });

  root.addEventListener('pointermove', (event) => {
    if (!drag || drag.keyboard || event.pointerId !== drag.pointerId) return;
    const { homes, from } = drag;
    // Held inside the strip: a band that can be flown across the screen covers
    // the image the colors were pulled from and says nothing more than this does.
    const shift = Math.min(
      homes.at(-1).left - homes[from].left,
      Math.max(homes[0].left - homes[from].left, event.clientX - drag.startX),
    );
    lift(shift, false);
    const to = nearestSlot(shift);
    if (to !== drag.to) openGap(to, !reduceMotion());
  });

  root.addEventListener('pointerup', (event) => {
    if (!drag || drag.keyboard || event.pointerId !== drag.pointerId) return;
    finishDrag(false);
  });

  root.addEventListener('pointercancel', (event) => {
    if (!drag || drag.keyboard || event.pointerId !== drag.pointerId) return;
    endDrag(true);
  });

  root.addEventListener('keydown', (event) => {
    const grip = gripOf(event.target);
    if (!grip || !REORDER_KEYS.has(event.key) || !cards.length) return;
    const scope = scopeOf(grip);
    const held = Boolean(drag?.keyboard);
    const grab = event.key === ' ' || event.key === 'Enter';
    if (!held && (drag || !grab)) return;
    event.preventDefault();
    if (!held) {
      beginDrag(ROLES.indexOf(grip.dataset.grip), true, scope);
      announceReorder(scope, `${roleLabel(drag.from, scope)} color lifted, position ${drag.from + 1} of ${ROLES.length}. Arrow keys move it, space drops it, escape puts it back.`);
      return;
    }
    if (grab) {
      finishDrag(true);
      return;
    }
    if (event.key === 'Escape') {
      endDrag(true);
      announceReorder(scope, 'Reorder cancelled.');
      return;
    }
    const step = { ArrowLeft: -1, ArrowRight: 1, Home: -ROLES.length, End: ROLES.length }[event.key];
    const to = Math.min(ROLES.length - 1, Math.max(0, drag.to + step));
    if (to === drag.to) return;
    openGap(to, !reduceMotion());
    lift(drag.homes[to].left - drag.homes[drag.from].left, !reduceMotion());
    announceReorder(scope, `Position ${to + 1} of ${ROLES.length}.`);
  });

  // A lifted band with nobody holding it would keep answering arrow keys aimed
  // at whatever took the focus.
  root.addEventListener('focusout', (event) => {
    if (!drag?.keyboard || event.target !== drag.grips[drag.from]) return;
    const scope = drag.scope;
    endDrag(true);
    announceReorder(scope, 'Reorder cancelled.');
  });
}

wireReorder(panel);
wireReorder(strategyBands);

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
  } else if (data.editTints) {
    // The button that opened the strip closes it, so the × is a second way out
    // rather than the only one.
    if (openTint === data.editTints) closeTints();
    else openTints(data.editTints);
  } else if (data.customColor) $(`[data-color-input="${data.customColor}"]`, panel).click();
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
    // Painted before the screen changes rather than on arrival: the next screen
    // is captured for the transition as it is handed over, and a strip still
    // holding last run's colors is what would be captured.
    paintStrategyBands();
    paintStage();
  }
};

/* The select button lives with the screen's actions rather than inside the
   fieldset, so the delegated handler above never reached it and the palette
   left the run as four empty fields. It commits the same state the bands are
   rendered from, reordered or not, so it is that handler and not a copy. */
$('[data-select-palette]').addEventListener('click', panel.onclick);

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
  // Coming back to the strategy screen from further along, where the palette may
  // have been reordered on the screen it was left on. A hidden block measures
  // zero, so its budget is resolved on arrival for the same reason the scale
  // sheet's fit is.
  if (event.detail.screen === '03') {
    paintStrategyBands();
    fitStrategyColumn();
  }
  // A per-surface question holds whatever tab it was left on while its own
  // screen is up, and the rest follow it.
  const leader = surfaceQuestions.find((question) => question.screen === event.detail.screen);
  leader?.paint();
  alignSurfaces(leader);
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
      plotMotionRoute();
      motionShown = null;
      replayMotion(checkedMotion());
    });
  }
  // A hidden sheet measures zero, so the fit can only be resolved on arrival.
  // The rest waits a frame: the screen change focuses the first control after
  // this event, and that scrolls the list back to the top.
  //
  // It also puts focus on the first interval rather than the chosen one, and
  // this list's preview reads focus twice: once to draw, and once to decide
  // what to fall back to when the pointer leaves. Left alone, a visitor arrives
  // to two columns set in an interval they never picked, and gets it again the
  // first time they browse the list and come back. So the answer takes the
  // focus, which is where a radio group's focus belongs anyway.
  if (event.detail.screen === '05') {
    fitScaleSheet();
    const chosen = checkedScale();
    requestAnimationFrame(() => {
      chosen?.parentElement.scrollIntoView({ block: 'center' });
      chosen?.focus({ preventScroll: true });
      if (chosen) drawTypeScale(chosen);
      syncSpecimenScroll();
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

// Screen 01b: the surface tiles. Multi-select with a floor of one, so the
// answer can never arrive empty; the continue button holds that line while
// the markup's default (persuade) keeps scripted runs moving.
const modeInputs = [...document.querySelectorAll('input[name="surface-modes"]')];
const modesNext = document.querySelector('[data-modes-next]');
const syncModesNext = () => {
  if (modesNext) modesNext.disabled = !modeInputs.some((input) => input.checked);
};

/* The palette is judged on a page, and which page that should be is answered
   here: the palette screen shows the preview of the surface being designed.
   Each tile already holds a finished drawing of its mode, so the chosen one is
   lifted out of the tile rather than restated on screen 02, which is the only
   way a new variant lands on both screens at once.

   First in tile order, not first clicked. A multi-select answer has no other
   stable primary, and click order would move the palette's test page around
   for reasons the visitor cannot see. */
const modeTiles = modeInputs.map((input) => input.closest('.picker-mode-tile'));
const modePreviews = modeTiles.map((tile) => tile?.querySelector('.picker-preview'));
const landingPreview = preview.cloneNode(true);
let previewSource;

function syncModePreview() {
  // The per-surface questions read the tiles rather than watch them, so they
  // are rebuilt from here: every path that changes the tiles already runs this.
  syncSurfaces();
  const chosen = modeInputs.findIndex((input) => input.checked);
  /* Which tile leads is also what the stylesheet needs, to hang the view
     transition's name on the one drawing screen 02 goes on to show. Marked
     ahead of the early return below, so the answer never rests on whether the
     drawing itself changed, and left off a tile whose drawing is not this
     component, since nothing of that tile arrives on the next screen. */
  modeTiles.forEach((tile, index) => {
    tile?.toggleAttribute('data-lead', index === chosen && Boolean(modePreviews[index]));
  });
  // A tile drawn in something other than this component keeps the landing page,
  // which is also the floor for the empty answer the continue button blocks.
  const source = (chosen === -1 ? null : modePreviews[chosen]) ?? landingPreview;
  if (source === previewSource) return;
  previewSource = source;
  const clone = source.cloneNode(true);
  // Decorative on both screens, but the marker sits on the tile's wrapper
  // rather than on the component, so it does not survive the lift by itself.
  clone.setAttribute('aria-hidden', 'true');
  for (const node of [clone, ...clone.querySelectorAll('[id]')]) node.removeAttribute('id');
  preview.replaceWith(clone);
  preview = clone;
  renderPreview();
}

/* ============================================================
   Questions answered once per surface.

   Several screens ask the same shape of question: the answer that suits the
   marketing page rarely suits the tool it sells, so it is asked once for each
   surface chosen on 01b. A tab on the frame's corner carries between them, an
   option a surface cannot take is turned off in place with the reason where
   its description was, and every chosen surface leaves an answer whether or
   not anyone ever opened its tab.

   A screen opts in by rendering one tab strip and nothing else:

     <div class="picker-surface-tabs" data-surface-tabs="<radio group name>"
          data-surface-answered="colored {}"
          data-surface-unanswered="no color strategy chosen yet" hidden>

   inside the stage the frame is drawn on, plus one disabled hidden field per
   surface marked data-surface-field="<group>-<surface>". That field is where
   the surface's answer is kept; whether it also carries a name, and so whether
   the run records a key per surface or only the leading surface's choice, is
   the question's own business. What each surface may take and where it
   lands untouched are already on the tiles as data-allow-<group> and
   data-default-<group>; why an option is out is on the option itself as
   data-blocked-reason. All of that comes from data/surfaces.js.

   Which surfaces the question is put to at all is the set of fields it
   rendered. A screen that leaves one out is asking nothing of that surface, so
   its tab is never offered, its answer is never defaulted, and the bare key
   falls to the leading surface that was asked. A screen every chosen surface
   was left out of is not part of the run: it goes out of the form and the
   navigation steps over it, because a key holding an answer nobody was asked
   for reads downstream as a decision, and nothing can tell the two apart.

   data-surface-stage on the frame additionally mounts one drawing per chosen
   surface, lifted from that surface's tile and painted with the committed
   palette. Screen 03 is the only screen that wants that today. A screen that
   draws its own per-surface variants instead marks each of them
   data-surface="<surface>" in its own markup and leaves the attribute off; the
   showing and hiding is the same work either way.
   ============================================================ */
const chosenSurfaces = () => modeInputs.filter((input) => input.checked);
const surfaceInput = (value) => modeInputs.find((input) => input.value === value);

function buildSurfaceQuestion(tabs) {
  const name = tabs.dataset.surfaceTabs;
  // The stage the strip sits on is also the box a per-surface drawing has to
  // land inside, so it is read off the DOM rather than named a second time in
  // the markup.
  const frame = tabs.parentElement;
  const screen = tabs.closest('.picker-screen')?.dataset.screen;
  const mounts = 'surfaceStage' in frame.dataset;
  const flat = 'surfaceFlat' in tabs.dataset;
  const properName = 'surfaceProperName' in tabs.dataset;
  /* The rows are markup on every screen but the font one, where they are dealt
     from fonts.json after this runs and can still be added to afterwards. So
     the group is read when it is needed rather than captured once. */
  const optionInputs = () => [...document.querySelectorAll(`input[name="${name}"]`)];
  const rowOf = (value) => optionInputs().find((input) => input.value === value)?.closest('.picker-strategy-option');
  // Read by attribute name rather than through dataset, so the group's own
  // value is the lookup and no screen has to restate it in camel case. A
  // question that rules nothing out carries no attribute at all, which is a
  // different answer from an empty one and is kept apart from it here.
  const allowedFor = (value) => {
    const allow = surfaceInput(value)?.getAttribute(`data-allow-${name}`);
    return allow == null ? null : new Set(allow.split(' ').filter(Boolean));
  };
  const defaultFor = (value) => surfaceInput(value)?.getAttribute(`data-default-${name}`) || optionInputs()[0]?.value;
  const fieldFor = (value) => document.querySelector(`input[type="hidden"][data-surface-field="${name}-${value}"]`);
  const titleOf = (value) => rowOf(value)?.querySelector('.picker-strategy-title')?.textContent ?? value;
  // The fields are the scope: a surface with nowhere to leave an answer is one
  // this question was never put to.
  const applies = (value) => Boolean(fieldFor(value));
  const applicable = () => chosenSurfaces().filter((input) => applies(input.value));
  // A question every surface takes is asked on every run; only a scoped one can
  // end up with nothing to ask.
  const scoped = modeInputs.some((input) => !applies(input.value));
  const host = tabs.closest('.picker-screen');
  let activeSurface = null;

  /* One drawing per chosen surface. All of them stay mounted and one is shown,
     so a tab switch costs a hidden attribute rather than a rebuild and the
     frame never blinks. */
  function mount(chosen) {
    for (const node of frame.querySelectorAll('[data-surface]')) node.remove();
    for (const input of chosen) {
      const source = modePreviews[modeInputs.indexOf(input)];
      if (!source) continue;
      const clone = source.cloneNode(true);
      // Decorative here as on the tile, but the marker sits on the tile's
      // wrapper rather than on the drawing, so it does not survive the lift.
      clone.setAttribute('aria-hidden', 'true');
      for (const node of [clone, ...clone.querySelectorAll('[id]')]) node.removeAttribute('id');
      clone.dataset.surface = input.value;
      frame.append(clone);
    }
    paint();
  }

  /* Painted once on the frame rather than on each drawing inside it, so the
     strategy layer keeps a fixed reading of what was chosen and the drawings
     themselves carry no inline color for it to argue with. */
  function paint() {
    if (mounts) syncCommittedPalette(frame, 'pkc');
  }

  function sync() {
    const chosen = applicable();
    /* Nothing left to ask, so the screen leaves the run: marked for the
       navigation to step over, and its group taken out of the form so no key
       comes back for it. applyApplicability() re-enables the rows the moment a
       surface that takes the question is chosen again. */
    if (scoped) {
      host?.toggleAttribute('data-skip', chosen.length === 0);
      for (const input of optionInputs()) input.disabled = chosen.length === 0;
    }
    if (mounts) mount(chosen);

    /* Every chosen surface leaves an answer whether or not it was ever opened,
       so the field is filled with the default the moment the tile is chosen and
       the tab reports it as unset until someone says otherwise. */
    for (const input of modeInputs) {
      const field = fieldFor(input.value);
      if (!field) continue;
      field.disabled = !input.checked;
      if (!input.checked) {
        field.value = '';
        delete field.dataset.chosen;
      } else if (!field.value) {
        // The font screen's rows are dealt after this first runs, so a question
        // with nothing to fall back on yet leaves the field to the sync that
        // follows the fetch.
        field.value = defaultFor(input.value) ?? '';
      }
    }

    buildTabs(chosen);
    show(chosen.some((input) => input.value === activeSurface) ? activeSurface : chosen[0]?.value);
  }

  /* One surface needs no tabs: the frame is already showing the only answer
     there is. A tab carries the surface it names and the dot that reports
     whether that surface has been answered; which of the two states it is in is
     markTabs()'s to write. */
  function buildTabs(chosen) {
    tabs.hidden = chosen.length < 2;
    tabs.replaceChildren(...chosen.map((input) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'picker-surface-tab';
      tab.dataset.surfaceTab = input.value;
      tab.innerHTML = '<span class="picker-surface-dot"></span>';
      tab.append(input.dataset.surfaceLabel ?? input.value);
      tab.onclick = () => choose(input.value);
      return tab;
    }));
    markTabs();
  }

  /* The answer a tab reports is its own surface's field rather than the radio
     on screen, which belongs to whichever tab is open. The dot says which kind
     of answer it is: filled once someone chose it, hollow while it is still the
     default the surface was given. The label says the answer itself, which the
     tab no longer shows. */
  function markTabs() {
    for (const tab of tabs.children) {
      const value = tab.dataset.surfaceTab;
      const field = fieldFor(value);
      const set = Boolean(field?.dataset.chosen);
      const on = value === activeSurface;
      const title = field.value ? titleOf(field.value) : '';
      const name = tab.textContent;
      tab.dataset.set = set ? 'yes' : 'no';
      tab.setAttribute('aria-pressed', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      /* A screen with no rows dealt yet has no answer to report, which is a
         different state from an answer nobody chose and is the one the
         question's unanswered sentence was written for. */
      const answered = title
        && tabs.dataset.surfaceAnswered.replace('{}', properName ? title : title.toLowerCase());
      tab.setAttribute('aria-label', title
        ? `${name}, ${answered}${set ? '' : ' by default'}`
        : `${name}, ${tabs.dataset.surfaceUnanswered}`);
    }
  }

  function show(value) {
    if (!value) return;
    activeSurface = value;
    for (const drawing of frame.querySelectorAll('[data-surface]')) {
      drawing.hidden = drawing.dataset.surface !== value;
    }
    applyApplicability();
    const field = fieldFor(value);
    const wanted = field?.value || defaultFor(value);
    const input = optionInputs().find((radio) => radio.value === wanted);
    if (input) input.checked = true;
    markTabs();
  }

  /* A tab the visitor moved to leads: every other per-surface question follows
     it, because the drawing on screen is painted from all of their answers at
     once and a board shown on the Docs tab has to be colored with the answer
     Docs was given. */
  function choose(value) {
    show(value);
    alignSurfaces(api);
  }

  /* An option a surface cannot carry is left in place and turned off rather
     than removed: the list keeps its shape as you move between surfaces, and
     the row says why it is out instead of vanishing without a reason. */
  function applyApplicability() {
    const allowed = allowedFor(activeSurface);
    for (const input of optionInputs()) {
      const row = input.closest('.picker-strategy-option');
      if (!row) continue;
      const ok = !allowed || allowed.has(input.value);
      const desc = row.querySelector('.picker-strategy-desc');
      desc.dataset.copy ??= desc.textContent;
      desc.textContent = ok ? desc.dataset.copy : row.dataset.blockedReason ?? desc.dataset.copy;
      row.classList.toggle('is-blocked', !ok);
      input.disabled = !ok;
    }
  }

  /* Delegated rather than bound row by row, for the same reason the group is
     read live: a pair uploaded halfway through the run has to answer into the
     surface it was chosen on like any row the page was built with. */
  document.addEventListener('change', ({ target }) => {
    if (target?.name !== name || !target.checked) return;
    record(target.value);
  });

  /* A flat question leaves one answer, so a choice made on one tab is the
     choice on every tab that can take it. Anything that rules it out keeps
     what it had, which is the whole reason the fields are kept per surface on
     a question that only writes one of them down. */
  function record(value) {
    const surfaces = flat ? applicable().map((input) => input.value) : [activeSurface];
    for (const surface of surfaces) {
      const field = fieldFor(surface);
      const allowed = allowedFor(surface);
      if (!field || (allowed && !allowed.has(value))) continue;
      field.value = value;
      field.dataset.chosen = 'yes';
    }
    markTabs();
  }

  /* Arrow keys walk the group, which is the one thing a row of buttons owes a
     keyboard once only the current tab is in the tab order. */
  tabs.addEventListener('keydown', (event) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!step) return;
    const buttons = [...tabs.children];
    const next = buttons[(buttons.findIndex((tab) => tab.dataset.surfaceTab === activeSurface) + step + buttons.length) % buttons.length];
    event.preventDefault();
    choose(next.dataset.surfaceTab);
    next.focus();
  });

  /* A question that is off screen previews an answer it did not ask for, so
     the radio the rest of the run reads is parked on whichever surface is
     being looked at, and on the leading one when nothing on screen is showing
     tabs. Without it the run would carry whichever surface was last on the tab,
     and an option switched off for that surface would leave the answer empty.

     A surface this question was never put to cannot lead it, so the leading
     surface overall is followed only where it was asked and the first surface
     in tile order that was asked leads otherwise. That is the rule the bare key
     is written by: a run of app UI plus a portfolio has app UI leading the
     questions both surfaces answer, and the portfolio leading motion. */
  const park = (surface) => show(applies(surface) ? surface : applicable()[0]?.value);

  const api = { screen, sync, paint, park, active: () => activeSurface };
  return api;
}

const surfaceQuestions = [...document.querySelectorAll('[data-surface-tabs]')].map(buildSurfaceQuestion);

/* One tab is showing at a time and every per-surface question reads it, so the
   one whose screen is up owns it and the rest are moved to match. */
function alignSurfaces(leader) {
  for (const question of surfaceQuestions) {
    if (question !== leader) question.park(leader?.active());
  }
}
const syncSurfaces = () => {
  for (const question of surfaceQuestions) question.sync();
};
const paintStage = () => {
  for (const question of surfaceQuestions) question.paint();
};

for (const input of modeInputs) {
  input.addEventListener('change', () => {
    syncModesNext();
    syncModePreview();
  });
}
syncModesNext();
syncModePreview();

try {
  const get = (url) => fetch(url).then((response) => response.ok ? response.json() : Promise.reject());
  const [cueData, seedData] = await Promise.all([get('/cues.json'), get('/palettes.json')]);
  // The agent's reading of PRODUCT.md arrives as cues.modes and pre-checks
  // the surface tiles. Applied only when it names at least one real tile, so
  // a bad hint cannot uncheck everything.
  if (Array.isArray(cueData.modes)) {
    const wanted = new Set(cueData.modes);
    if (modeInputs.some((input) => wanted.has(input.value))) {
      for (const input of modeInputs) input.checked = wanted.has(input.value);
      syncModesNext();
      syncModePreview();
    }
  }
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
