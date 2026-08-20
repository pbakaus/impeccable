import { contrastInk, contrastInkHex, formatOklch, hexToOklch, neutralContrastIssue, oklchToHex, readableOn, seedToRoles } from './color.js';

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
  proof: ['Lorem ipsum dolor', 'Sit amet elit dolor', 'Sed do eiusmod', 'Tempor incididunt'],
  sectionTitle: 'Lorem ipsum dolor',
  sectionLink: 'Consectetur adipiscing',
  gallery: [
    { title: 'Lorem ipsum dolor', meta: 'sit amet consectetur' },
    { title: 'Dolor sit amet', meta: 'consectetur elit' },
    { title: 'Eiusmod tempor', meta: 'sed do eiusmod' },
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
  caption:
    'Lorem ipsum dolor sit amet,\nconsectetur adipiscing elit sed do eiusmod tempor.',
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

/* Deliberately Latin faces with English copy, same as the constraint on
   dealt pairs in visual-cues.md Step 6. TODO: lift both together when the
   picker's previews learn non-Latin scripts and per-language font subsets. */
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
  syncNeutralAlert();
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
  fill(
    '[data-type-section-body]',
    `${LOREM.paragraph} Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.`,
  );
  fill('[data-type-section-link]', preview.sectionLink);
  fill('[data-type-footer-mark]', preview.footerMark);
  fill('[data-type-note-label]', LOREM_DOCS.note);
  fill('[data-type-note-body]', LOREM.note);
  fill('[data-type-crumb]', LOREM_DOCS.crumb);
  fill('[data-type-caption]', LOREM_INDEX.caption);
  fill('[data-type-chart-title]', LOREM_APP.chartTitle);
  const fillGalleryCaptions = (root, items) => {
    if (!root) return;
    root.querySelectorAll('.ps-gallery-item [data-type-gallery-caption]').forEach((node, index) => {
      const item = items[index];
      if (item) node.textContent = `${item.title} ${item.meta}`;
    });
  };
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
    fillGalleryCaptions(card, preview.gallery);
  }
  fillIndexed(desktop?.querySelector('.ps-footer'), '[data-type-footer-link]', preview.footerLinks);
  applyFontPairGalleryParity(board);
}

/* Gallery parity (plan-18): font-pair cells match the strategy-fixes JS blocks
   in previews-gallery-improved.html for persuade editorial merge, gallery
   captions, read title trim, and experience cap avatars. */
function applyFontPairGalleryParity(board) {
  const surface = board.dataset.surface;
  if (surface === 'persuade') {
    board.querySelectorAll('.ps-editorial-copy > em[data-type-section-link]').forEach((el) => el.remove());
    const merged =
      'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.';
    board.querySelectorAll('[data-type-section-body]').forEach((p) => {
      if (p.hasAttribute('data-type-section-body-2')) {
        p.remove();
        return;
      }
      const second = p.nextElementSibling;
      if (second?.hasAttribute('data-type-section-body-2')) {
        p.textContent = merged;
        second.remove();
        return;
      }
      p.textContent = merged;
    });
    const captions = [
      'Lorem ipsum dolor sit amet consectetur',
      'Dolor sit amet consectetur elit',
      'Eiusmod tempor sed do eiusmod',
    ];
    board.querySelectorAll('.ps-gallery-item').forEach((item, index) => {
      const text = captions[index];
      if (!text) return;
      const caption = item.querySelector('[data-type-gallery-caption]');
      if (caption) {
        caption.textContent = text;
        return;
      }
      const title = item.querySelector('[data-type-gallery-title]');
      const meta = item.querySelector('[data-type-gallery-meta]');
      if (!title) return;
      title.removeAttribute('data-type-gallery-title');
      title.setAttribute('data-type-gallery-caption', '');
      title.textContent = text;
      meta?.remove();
    });
  }
  if (surface === 'read') {
    board.querySelectorAll('[data-type-section-title]').forEach((el) => {
      if (el.textContent.trim() === 'Lorem ipsum dolor sit') el.textContent = 'Lorem ipsum dolor';
    });
  }
  if (surface === 'experience') {
    board.querySelectorAll('[data-type-caption]').forEach((el) => {
      el.textContent =
        'Lorem ipsum dolor sit amet,\nconsectetur adipiscing elit sed do eiusmod tempor.';
    });
    board.querySelectorAll('.ps-desktop .ps-index-cap').forEach((cap) => {
      if (cap.querySelector('.ps-index-avatar')) return;
      const avatar = document.createElement('i');
      avatar.className = 'ps-index-avatar';
      avatar.setAttribute('aria-hidden', 'true');
      cap.insertBefore(avatar, cap.firstChild);
    });
  }
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
/* Gallery parity: the premium motion previews are not drawn on this screen's
   own artboards. tmp/motion-previews-premium.html shapes the landing board the
   way preview 33 is shaped and hands it a phone, and swaps the portfolio board
   for preview 48's gallery drawing, then layers the animation overrides on top.
   Every one of those overrides addresses that markup, so the boards are rebuilt
   here before anything else reads them. Both strings are lifted verbatim from
   that file by tmp/plan18-verify/port-motion-boards.mjs. */
const PREVIEW_33_PHONE_HTML = '<div class="ps-phone"><div class="ps-phone-top"><div class="ps-nav-lede"><div class="ps-brand-block"></div><i class="ps-brand-word"></i></div><div class="ps-nav-tail"><div class="ps-nav-action"></div><i class="ps-menu"></i></div></div><div class="ps-phone-body"><div class="ps-layout-grid" aria-hidden="true"></div><div class="ps-image"></div><div class="ps-headline"><i></i><i></i></div><div class="ps-copy"><i></i><i></i></div><div class="ps-actions"><i></i><i></i></div><div class="ps-proof"><div class="ps-proof-item"><i></i><span class="ps-proof-lines"><b></b><b></b></span></div><i class="ps-proof-divider" aria-hidden="true"></i><div class="ps-proof-item"><i></i><span class="ps-proof-lines"><b></b><b></b></span></div></div><div class="ps-editorial-copy"><strong></strong><span><i></i><i></i></span></div><div class="ps-gallery"><div class="ps-gallery-item"><i></i><span><b></b><b></b></span></div><div class="ps-gallery-item"><i></i><span><b></b><b></b></span></div></div></div><div class="ps-phone-footer"><i></i><i></i><i></i></div></div>';
const PREVIEW_48_PORTFOLIO_HTML = '<span class="picker-preview picker-preview--gallery picker-preview-motion picker-preview-motion--index" aria-hidden="true" data-surface="experience" hidden><span class="pv-desktop"><span class="pv-nav"><span class="pv-logo"></span><span class="pv-nav-bars"><i></i><i></i><i></i></span><span class="pv-pill"></span></span><span class="pg-body"><span class="pg-row"><span class="pv-image"></span><span class="pg-cap"><i class="pg-cap-title" style="--w:33.61%"></i><i></i><i style="--w:65.3%"></i></span></span><span class="pg-row pg-row--flip"><span class="pg-cap"><i class="pg-cap-title" style="--w:36.64%"></i><i></i><i style="--w:66.07%"></i></span><span class="pv-image"></span></span><span class="pg-rail"><i class="pg-arrow"></i><span class="pg-track"><i class="pg-track-on" style="--w: 20.31"></i><i style="--w: 9.14"></i><i style="--w: 8.98"></i><i style="--w: 12.44"></i></span><i class="pg-arrow pg-arrow--next"></i></span></span><i class="ps-cursor" data-cursor aria-hidden="true"></i></span><span class="pv-phone"><span class="pv-phone-top"><span class="pv-logo"></span><span class="pv-avatar"></span></span><span class="pg-phone-body"><span class="pv-image"></span><span class="pg-cap"><i class="pg-cap-title" style="--w:30.18%"></i><i style="--w:79.68%"></i><i style="--w:55.6%"></i></span><span class="pv-image"></span><span class="pg-cap"><i class="pg-cap-title" style="--w:30.18%"></i><i style="--w:79.68%"></i><i style="--w:55.6%"></i></span></span><span class="pv-tabbar"><i></i><i></i><i></i></span></span></span>';

function rebuildPremiumMotionBoards() {
  for (const board of document.querySelectorAll('.picker-preview-motion[data-motion-cell]')) {
    if (board.dataset.surface === 'persuade') {
      const desktop = board.querySelector('.ps-desktop');
      if (!desktop) continue;
      /* Solo is the one-column framing this screen used while the board had no
         phone; preview 33's two columns come back with it. */
      board.classList.remove('picker-artboard--solo');
      board.classList.add('picker-strategy-preview', 'picker-preview-layout');
      board.setAttribute('data-carry', '');
      if (!desktop.querySelector(':scope > .ps-layout-grid')) {
        desktop.insertAdjacentHTML('afterbegin', '<div class="ps-layout-grid" aria-hidden="true"></div>');
      }
      if (!board.querySelector(':scope > .ps-phone')) {
        board.insertAdjacentHTML('beforeend', PREVIEW_33_PHONE_HTML);
      }
      continue;
    }
    if (board.dataset.surface !== 'experience') continue;
    const template = document.createElement('template');
    template.innerHTML = PREVIEW_48_PORTFOLIO_HTML;
    const gallery = template.content.firstElementChild;
    if (!gallery) continue;
    /* Everything but the class list moves across: the cell key and the tab
       state are the board's identity downstream, and data-artboard is what
       keeps the palette painter writing --pv-* onto it. The premium file gets
       those same values from the inline style its capture baked in; here they
       are painted at runtime, which is the whole point of the live boards.
       The class list does NOT move: preview 48 is a .picker-preview drawing,
       not an artboard, and picker-artboard would restyle it. */
    for (const attr of board.attributes) {
      if (attr.name === 'class') continue;
      gallery.setAttribute(attr.name, attr.value);
    }
    board.replaceWith(gallery);
  }
}
rebuildPremiumMotionBoards();

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
    /* A premium scene that runs its own sequencer parks its restart on the
       board, because a scene whose animations were replayed under a sequencer
       still holding an earlier step would draw two moments at once. */
    scene.__replayMotion?.();
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
  '--mtr-nav1': '.ps-nav-bars i:nth-child(1), .pv-nav-bars i:nth-child(1)',
  '--mtr-nav2': '.ps-nav-bars i:nth-child(2), .pv-nav-bars i:nth-child(2)',
  '--mtr-cta1': '.ps-actions i:first-child',
  '--mtr-cta2': '.ps-actions i:last-child',
  '--mtr-card1': '.ps-gallery-item:nth-child(1) > i',
  '--mxi-work1': '.ps-index-row:nth-of-type(1) > .ps-image, .pg-row:nth-of-type(1) > .pv-image',
  '--mxi-work2': '.ps-index-row:nth-of-type(2) > .ps-image, .pg-row:nth-of-type(2) > .pv-image',
  '--mxi-rail': '.ps-index-arrow--next, .pg-arrow--next',
};

function plotMotionRoute(scene = null) {
  for (const board of scene ? [scene] : motionScenes) {
    const desk = board.querySelector('.ps-desktop, .pv-desktop');
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
    const nav1 = desk.querySelector('.ps-nav-bars i:nth-child(1), .pv-nav-bars i:nth-child(1)');
    if (nav1) board.style.setProperty('--mtr-entry', `${center(nav1).x.toFixed(2)}cqw -8cqh`);
  }
}

for (const scene of motionScenes) {
  new ResizeObserver(() => plotMotionRoute(scene)).observe(scene.querySelector('.ps-desktop, .pv-desktop'));
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

/* Premium motion overrides: ported from tmp/motion-previews-premium.html,
   which is the source of truth for these six cells. Each installer was written
   against an iframe holding one (surface, option) page, so boardScope() gives
   it the same world inside the live document: element queries resolve inside
   the board, style and DOM creation go to the real document. Colors, timings,
   easings and keyframes are byte-exact from that file; only the selector scope
   is rewritten, by tmp/plan18-verify/port-motion2.mjs. */
function boardScope(board) {
  return {
    head: document.head,
    documentElement: document.documentElement,
    createElement: (tag) => document.createElement(tag),
    getElementById: (id) => document.getElementById(id),
    /* The premium selectors sometimes name the board itself, which a plain
       descendant query inside the board can never answer. */
    querySelector: (sel) => (board.matches(sel) ? board : board.querySelector(sel)),
    querySelectorAll: (sel) => (board.matches(sel) ? [board] : board.querySelectorAll(sel)),
  };
}

function installPremiumMotion() {
  /* motionBoard rather than board: several installers declare their own
     const board inside their body, and a shared name would put the guard
     above it in that binding's temporal dead zone. */
  for (const motionBoard of document.querySelectorAll('.picker-preview-motion[data-motion-cell]')) {
    const doc = boardScope(motionBoard);
    const win = window;
    const cell = motionBoard.dataset.motionCell;

    const installPerfectCursorLoop = () => {
        if (!doc?.head) return;
        if (motionBoard.hasAttribute('data-premium-restrained-landing-perfect-loop')) return;
        motionBoard.setAttribute('data-premium-restrained-landing-perfect-loop', '');

        const style = doc.createElement('style');
        style.id = 'restrained-landing-perfect-loop';
        style.textContent = `
          .picker-preview-motion[data-motion-cell="persuade-restrained"] .ps-cursor {
            animation: 3.8s ease-in-out infinite mtr-path-perfect-loop !important;
          }

          .picker-preview-motion[data-motion-cell="persuade-restrained"] .ps-nav-bars i:nth-child(2),
          .picker-preview-motion[data-motion-cell="persuade-restrained"] .ps-nav-bars i:nth-child(2)::before,
          .picker-preview-motion[data-motion-cell="persuade-restrained"] .ps-nav-bars i:nth-child(2)::after,
          .picker-preview-motion[data-motion-cell="persuade-restrained"] .ps-actions i:last-child {
            animation: none !important;
          }

          /* Cursor movement matched to the Responsive cell: ease-in-out glide
             with ~0.4s hops between stops (the old timing was linear with a
             1.25s nav-to-CTA crawl inherited from the original 5-stop path). */
          @keyframes mtr-path-perfect-loop {
            0%, 22% {
              translate: var(--mtr-nav1, 64.8cqw 4.8cqh);
            }
            32.5%, 47.5% {
              translate: var(--mtr-cta1, 10.3cqw 48.4cqh);
            }
            58%, 85% {
              translate: var(--mtr-email, 17.8cqw 84.2cqh);
            }
            100% {
              translate: var(--mtr-nav1, 64.8cqw 4.8cqh);
            }
          }

          /* The captured hover states are synced to the old path percentages;
             re-declare them against the retimed dwells (last definition wins). */
          @keyframes mtr-nav-1 {
            0%, 21.99% { background-color: var(--pvs-cta); }
            22%, 100% { background-color: var(--pvs-bars); }
          }
          @keyframes mtr-drop-1 {
            0%, 3.99% { opacity: 0; }
            4%, 18.99% { opacity: 1; }
            19%, 100% { opacity: 0; }
          }
          @keyframes mtr-cta-primary {
            0%, 32.49% { background-color: var(--pvs-cta); box-shadow: inset 0 0 0 0 var(--pvs-cta); }
            32.5%, 47.49% { background-color: var(--pvs-ghost); box-shadow: inset 0 0 0 1.5px var(--pvs-cta); }
            47.5%, 100% { background-color: var(--pvs-cta); box-shadow: inset 0 0 0 0 var(--pvs-cta); }
          }

          /* Hover color change on the email capture button while the cursor
             dwells on it, mirroring the captured instant-flip hover pattern. */
          .picker-preview-motion[data-motion-cell="persuade-restrained"] .ps-editorial-copy > em {
            animation:
              mt-in-4 var(--mt) var(--mt-ease) infinite,
              mtr-email-hover 3.8s linear infinite !important;
          }
          .picker-preview-motion[data-motion-cell="persuade-restrained"] .ps-editorial-copy > em::after {
            animation: mtr-email-hover-icon 3.8s linear infinite;
          }
          @keyframes mtr-email-hover {
            0%, 57.99% { background-color: var(--pvs-ghost); }
            58%, 84.99% { background-color: var(--pvs-cta); }
            85%, 100% { background-color: var(--pvs-ghost); }
          }
          @keyframes mtr-email-hover-icon {
            0%, 57.99% { background-color: var(--pvs-cta); }
            58%, 84.99% { background-color: var(--pvs-cta-text); }
            85%, 100% { background-color: var(--pvs-cta); }
          }

          @media (prefers-reduced-motion: reduce) {
            .picker-preview-motion[data-motion-cell="persuade-restrained"] .ps-cursor {
              animation: none !important;
              translate: var(--mtr-nav1, 64.8cqw 4.8cqh) !important;
            }
            .picker-preview-motion[data-motion-cell="persuade-restrained"] .ps-editorial-copy > em,
            .picker-preview-motion[data-motion-cell="persuade-restrained"] .ps-editorial-copy > em::after {
              animation: none !important;
            }
          }
        `;
        if (!doc.getElementById(style.id)) doc.head.appendChild(style);
      }

    const installResponsiveLandingCorrections = () => {
        if (!doc?.head) return;
        if (motionBoard.hasAttribute('data-premium-responsive-landing-corrections')) return;
        motionBoard.setAttribute('data-premium-responsive-landing-corrections', '');

        const style = doc.createElement('style');
        style.id = 'responsive-landing-corrections';
        style.textContent = `
          /* Keep the Preview 33 layout continuously present. The shared motion
             entrance loops were restarting underneath the responsive interaction
             and briefly collapsing most of the desktop and phone content. */
          .picker-preview-motion[data-motion-cell="persuade-responsive"] :is(
            .ps-nav,
            .ps-hero-copy > *,
            .ps-hero > .ps-image,
            .ps-proof-item,
            .ps-editorial-copy > strong,
            .ps-editorial-copy > span,
            .ps-gallery,
            .ps-footer
          ) {
            animation: none !important;
            opacity: 1 !important;
            clip-path: none !important;
            translate: none !important;
          }

          .picker-preview-motion[data-motion-cell="persuade-responsive"] .ps-cursor {
            animation: 4.2s ease-in-out infinite mtv-path-perfect-loop !important;
          }

          .picker-preview-motion[data-motion-cell="persuade-responsive"] .ps-gallery-item:first-child > i::after {
            top: 50% !important;
            bottom: auto !important;
            transform: translateY(-50%);
          }

          @keyframes mtv-path-perfect-loop {
            0%, 25% {
              translate: var(--mtr-nav1, 64.8cqw 4.8cqh);
            }
            34.52%, 50% {
              translate: var(--mtr-cta1, 10.3cqw 48.4cqh);
            }
            60.71%, 83.33% {
              translate: var(--mtr-email, 17.8cqw 84.2cqh);
            }
            100% {
              translate: var(--mtr-nav1, 64.8cqw 4.8cqh);
            }
          }

          @media (prefers-reduced-motion: reduce) {
            .picker-preview-motion[data-motion-cell="persuade-responsive"] .ps-cursor {
              animation: none !important;
              translate: var(--mtr-nav1, 64.8cqw 4.8cqh) !important;
            }
          }
        `;
        if (!doc.getElementById(style.id)) doc.head.appendChild(style);
      }

    const installChoreographedPremium = () => {
        if (!doc?.head) return;
        if (motionBoard.hasAttribute('data-premium-choreographed-landing-premium')) return;
        motionBoard.setAttribute('data-premium-choreographed-landing-premium', '');

        const style = doc.createElement('style');
        style.id = 'choreographed-landing-premium';
        style.textContent = `
          /* Premium pass: the page is fully present for the whole loop; motion is
             carried by light, focus, and filters instead of staged reveals. All
             reveal keyframes are re-declared empty (last definition wins), which
             leaves their elements at their natural resting styles. */
          @keyframes mtc-curtain {}
          @keyframes mtc-nav {}
          @keyframes mtc-eyebrow {}
          @keyframes mtc-headline-1 {}
          @keyframes mtc-headline-2 {}
          @keyframes mtc-copy-1 {}
          @keyframes mtc-copy-2 {}
          @keyframes mtc-copy-3 {}
          @keyframes mtc-actions {}
          @keyframes mtc-dot {}
          @keyframes mtc-pdot {}
          @keyframes mtc-pline {}
          @keyframes mtc-pdiv {}
          @keyframes mtc-ed-title {}
          @keyframes mtc-ed-line-1 {}
          @keyframes mtc-ed-line-2 {}
          @keyframes mtc-ed-dash {}
          @keyframes mtc-g-img-1 {}
          @keyframes mtc-g-lab-1 {}
          @keyframes mtc-g-lab-2 {}
          @keyframes mtc-g-lab-3 {}
          @keyframes mtc-g-lab-4 {}
          @keyframes mtc-footer {}

          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-desktop::after {
            animation: none !important;
            opacity: 0 !important;
          }

          /* The reveals ended on the visible state; with the reveal keyframes
             emptied, the elements' hidden base styles (clip-path insets,
             opacity 0, small translates) must be overridden to their resting
             visible state. Pseudo-elements are excluded so the hover/tint
             choreography keeps animating. */
          .picker-preview-motion[data-motion-cell="persuade-choreographed"] :is(
            .ps-nav, .ps-nav-bars i,
            .ps-headline i, .ps-copy i,
            .ps-proof *, .ps-footer, .ps-footer *,
            .ps-gallery, .ps-gallery-item, .ps-gallery-item > i,
            .ps-gallery-item span, .ps-gallery-item span b,
            .ps-brand, .ps-brand i
          ) {
            opacity: 1 !important;
            clip-path: none !important;
            translate: none !important;
            scale: none !important;
          }

          /* The proof dots' reveal ended on the CTA color; without the reveal
             they must rest there. */
          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-proof-item i {
            background-color: var(--pvs-cta);
          }

          /* Cursor route: a closed circuit that ends exactly where it starts.
             CTA (glow) -> gallery card (tint) -> email capture (submit story) ->
             hero (light pass) -> back to the CTA. */
          @keyframes mtc-path {
            0%, 14% { translate: var(--mtr-cta1, 12.9cqw 49.2cqh); }
            22%, 36% { translate: var(--mtr-card1, 43.5cqw 75.8cqh); }
            44%, 62% { translate: var(--mtr-email, 17.8cqw 84.2cqh); }
            70%, 84% { translate: 72.8cqw 34.9cqh; }
            100% { translate: var(--mtr-cta1, 12.9cqw 49.2cqh); }
          }

          /* Specular sweep over the hero image: an ambient opening pass, then a
             second pass while the cursor rests on the hero. */
          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-hero > .ps-image::before {
            content: "";
            position: absolute;
            inset: 0;
            border-radius: inherit;
            pointer-events: none;
            background-image: linear-gradient(115deg,
              transparent 42%,
              color-mix(in oklab, var(--pvs-ground) 30%, transparent) 50%,
              transparent 58%);
            background-size: 320% 100%;
            background-repeat: no-repeat;
            background-position: 115% 0;
            animation: 5.6s linear infinite mtc-hero-sheen;
          }
          @keyframes mtc-hero-sheen {
            0% { background-position: 115% 0; animation-timing-function: cubic-bezier(.45, 0, .25, 1); }
            14%, 67.99% { background-position: -15% 0; }
            68% { background-position: 115% 0; animation-timing-function: cubic-bezier(.45, 0, .25, 1); }
            84%, 100% { background-position: -15% 0; }
          }

          /* CTA glow bloom while the cursor dwells on the filled button. */
          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-actions i:first-child {
            animation: 5.6s linear infinite mtc-cta-glow !important;
          }
          @keyframes mtc-cta-glow {
            0%, 0.8% { filter: drop-shadow(0 0 0 transparent) brightness(1); animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            2.5%, 12.5% { filter: drop-shadow(0 4px 11px color-mix(in oklab, var(--pvs-cta) 72%, transparent)) brightness(1.14); animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            17%, 100% { filter: drop-shadow(0 0 0 transparent) brightness(1); }
          }

          /* Card hover: the tint fades in cleanly (no wipe, no blur), slightly
             translucent so the artwork shades it. */
          @keyframes mtc-tint {
            0%, 21.5% { opacity: 0; clip-path: inset(0); animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            24.5%, 34.5% { opacity: .92; clip-path: inset(0); animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            38.5%, 100% { opacity: 0; clip-path: inset(0); }
          }
          @keyframes mtc-label {
            0%, 23% { background-color: var(--pvs-bars); width: 76%; animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            26%, 34.5% { background-color: var(--pvs-cta); width: 84%; animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            38.5%, 100% { background-color: var(--pvs-bars); width: 76%; }
          }
          @keyframes mtc-chev {
            0%, 24% { opacity: 0; translate: -6px; }
            26.5% { opacity: 1; translate: -6px; animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            30%, 34.5% { opacity: 1; translate: 0; }
            38%, 100% { opacity: 0; translate: 0; }
          }

          /* Hero lift while the cursor and the light pass rest on it (no blur). */
          @keyframes mtc-image {
            0%, 70% { filter: saturate(1) brightness(1); animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            74%, 84% { filter: saturate(1.1) brightness(1.03); animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            90%, 100% { filter: saturate(1) brightness(1); }
          }
          @keyframes mtc-g-img-2 {}
          @keyframes mtc-g-img-3 {}
          @keyframes mtc-g-img-4 {}

          /* Email capture submit story, timed to the cursor's 44-62% dwell:
             press, click ring, the paper plane pulls back and launches on an
             arc with a sharp two-ghost trail, the button fills while a sonar
             ring radiates, the field line clears, the check pops with an
             overshoot, then everything settles back before the loop wraps. */
          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-editorial-copy > em {
            transform-origin: 50% 50% !important;
            animation: mtc-email-btn 5.6s linear infinite !important;
          }
          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-editorial-copy > em::after {
            animation: mtc-email-flight 5.6s linear infinite !important;
          }
          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-editorial-copy > em::before {
            animation: mtc-email-check 5.6s linear infinite !important;
          }
          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-editorial-copy > span i:last-child {
            transform-origin: 0 50%;
            animation: mtc-email-line 5.6s linear infinite !important;
          }
          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-cursor::after {
            animation: mtc-email-click 5.6s linear infinite !important;
          }
          @keyframes mtc-email-btn {
            0%, 44.6% { scale: 1; background-color: var(--pvs-ghost); box-shadow: inset 0 0 0 1px var(--pvs-cta), 0 0 0 0 transparent; animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            45.6% { scale: .93; animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            47.4% { scale: 1; background-color: var(--pvs-ghost); }
            48.2% { box-shadow: inset 0 0 0 1px var(--pvs-cta), 0 0 0 0 color-mix(in oklab, var(--pvs-cta) 50%, transparent); }
            50.5% { background-color: var(--pvs-cta); }
            56% { box-shadow: inset 0 0 0 1px var(--pvs-cta), 0 0 0 12px transparent; }
            76% { background-color: var(--pvs-cta); }
            82%, 100% { scale: 1; background-color: var(--pvs-ghost); box-shadow: inset 0 0 0 1px var(--pvs-cta), 0 0 0 12px transparent; }
          }
          @keyframes mtc-email-flight {
            0%, 46% { opacity: 1; transform: translate(-50%, -50%) rotate(0deg); background-color: var(--pvs-cta); filter: drop-shadow(0 0 0 transparent) drop-shadow(0 0 0 transparent); }
            47.2% { transform: translate(-64%, -34%) rotate(9deg); background-color: var(--pvs-cta); animation-timing-function: cubic-bezier(.5, 0, .8, .4); }
            49.4% { opacity: 1; transform: translate(calc(-50% + 30px), calc(-50% - 12px)) rotate(-16deg); background-color: var(--pvs-cta-text); filter: drop-shadow(-6px 3px 0 color-mix(in oklab, var(--pvs-cta-text) 45%, transparent)) drop-shadow(-12px 6px 0 color-mix(in oklab, var(--pvs-cta-text) 18%, transparent)); animation-timing-function: cubic-bezier(.2, .6, .4, 1); }
            52.5% { opacity: 0; transform: translate(calc(-50% + 78px), calc(-50% - 16px)) rotate(-4deg); background-color: var(--pvs-cta-text); filter: drop-shadow(-6px 3px 0 transparent) drop-shadow(-12px 6px 0 transparent); }
            52.6%, 80% { opacity: 0; transform: translate(-50%, -50%) rotate(0deg); background-color: var(--pvs-cta); filter: drop-shadow(0 0 0 transparent) drop-shadow(0 0 0 transparent); }
            85%, 100% { opacity: 1; transform: translate(-50%, -50%) rotate(0deg); }
          }
          @keyframes mtc-email-check {
            0%, 50.5% { opacity: 0; transform: translate(calc(-50% - 14px), -62%) rotate(45deg) scale(.5); animation-timing-function: cubic-bezier(.34, 1.56, .64, 1); }
            55% { opacity: 1; transform: translate(calc(-50% - 14px), -62%) rotate(45deg) scale(1.12); }
            57.5%, 74% { opacity: 1; transform: translate(calc(-50% - 14px), -62%) rotate(45deg) scale(1); }
            80%, 100% { opacity: 0; transform: translate(calc(-50% - 14px), -62%) rotate(45deg) scale(.5); }
          }
          @keyframes mtc-email-line {
            0%, 48.5% { scale: 1 1; animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            53%, 78% { scale: 0 1; }
            84%, 100% { scale: 1 1; }
          }
          @keyframes mtc-email-click {
            0%, 44.4% { opacity: 0; scale: .35; }
            44.9% { opacity: .55; scale: .35; }
            47.6%, 100% { opacity: 0; scale: 1.5; }
          }

          @media (prefers-reduced-motion: reduce) {
            .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-cursor {
              animation: none !important;
              translate: var(--mtr-cta1, 12.9cqw 49.2cqh) !important;
            }
            .picker-preview-motion[data-motion-cell="persuade-choreographed"] :is(
              .ps-hero > .ps-image,
              .ps-actions i:first-child,
              .ps-gallery-item > i,
              .ps-gallery-item:first-child span b:first-child,
              .ps-editorial-copy > em,
              .ps-editorial-copy > span i:last-child
            ),
            .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-hero > .ps-image::before,
            .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-gallery-item:first-child > i::before,
            .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-gallery-item:first-child > i::after,
            .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-editorial-copy > em::before,
            .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-editorial-copy > em::after,
            .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-cursor::after {
              animation: none !important;
            }
          }
        `;
        if (!doc.getElementById(style.id)) doc.head.appendChild(style);

        /* Preview 28 now has one continuous motion story: the five-part Motion
           OSS Hero stagger, followed by a push-scroll into a three-card pricing
           comparison. This final sheet cancels every inherited cursor, hover,
           reveal, sheen, email, and ambient animation; the Web Animations sequence
           below owns the complete scene. */
        const staggerStyle = doc.createElement('style');
        staggerStyle.id = 'choreographed-hero-stagger-only';
        staggerStyle.textContent = `
          .picker-preview-motion[data-motion-cell="persuade-choreographed"],
          .picker-preview-motion[data-motion-cell="persuade-choreographed"] *,
          .picker-preview-motion[data-motion-cell="persuade-choreographed"] *::before,
          .picker-preview-motion[data-motion-cell="persuade-choreographed"] *::after {
            animation: none !important;
            transition: none !important;
          }

          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-desktop::after {
            opacity: 0 !important;
          }

          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-cursor {
            opacity: 0 !important;
          }

          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-hero > .ps-image::before {
            content: none !important;
          }

          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-editorial-copy > em::before {
            opacity: 0 !important;
          }

          .picker-preview-motion[data-motion-cell="persuade-choreographed"] :is(
            .ps-eyebrow,
            .ps-headline,
            .ps-copy,
            .ps-actions,
            .ps-proof
          ) {
            opacity: 1;
            filter: none;
            transform: none;
            clip-path: none !important;
            translate: none !important;
            scale: none !important;
          }

          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-choreo-viewport {
            z-index: 1;
            min-width: 0;
            min-height: 0;
            height: 90.6%;
            overflow: hidden;
            position: absolute;
            inset: 9.4% 0 auto;
          }

          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-nav {
            z-index: 3;
            position: relative;
            background-color: var(--pvs-ground);
          }

          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-choreo-track {
            display: grid;
            grid-template-rows: repeat(2, minmax(0, 1fr));
            width: 100%;
            height: 200%;
            min-height: 0;
          }

          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-choreo-page {
            display: grid;
            grid-template-rows: 50.6fr 9fr 22.7fr 8.3fr;
            min-width: 0;
            min-height: 0;
          }

          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-choreo-page > .ps-proof {
            margin-inline: var(--pvs-proof-inset, 0px);
            border: var(--pvs-panel-edge-w) solid var(--pvs-panel-edge);
            border-radius: var(--pvs-radius-surface);
          }

          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-page {
            --ps-pricing-accent-muted: #607272;
            --ps-pricing-accent-dark: #0b3f3f;
            box-sizing: border-box;
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            align-items: center;
            gap: 4%;
            min-width: 0;
            min-height: 0;
            padding: 0 7.9%;
            background-color: var(--pvs-ground);
          }

          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-card {
            --ps-pricing-accent: var(--ps-pricing-accent-dark);
            box-sizing: border-box;
            display: grid;
            grid-template-rows: auto auto 1px minmax(0, 1fr) auto;
            gap: 4cqh;
            align-self: center;
            width: 100%;
            height: 50.8cqh;
            min-width: 0;
            min-height: 0;
            padding: 5cqh 1.3cqw 2.4cqh;
            overflow: hidden;
            background-color: var(--pvs-ground);
            border: 1px solid var(--ps-pricing-accent);
            border-radius: var(--pvs-radius-surface);
            translate: 0 -3cqh;
          }

          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-card:nth-child(1) {
            --ps-pricing-accent: var(--ps-pricing-accent-muted);
          }

          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-card:nth-child(n + 2) {
            border-width: 2px;
          }

          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-tier,
          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-price > *,
          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-features > i,
          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-action {
            display: block;
            border-radius: var(--pvs-radius-bar);
          }

          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-tier {
            justify-self: center;
            width: 32%;
            height: 2cqh;
            background-color: var(--ps-pricing-accent);
          }

          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-price {
            display: grid;
            justify-items: center;
            gap: 2.6cqh;
            min-width: 0;
          }

          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-price > b {
            width: 54%;
            height: 4.9cqh;
            background-color: var(--ps-pricing-accent);
          }

          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-price > i {
            width: 33%;
            height: .9cqh;
            background-color: var(--pvs-bars);
          }

          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-divider {
            display: block;
            justify-self: center;
            width: 90%;
            height: 1px;
            background-color: var(--pvs-bars);
          }

          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-features {
            display: grid;
            align-content: center;
            gap: 2.5cqh;
            min-height: 0;
            padding-inline: 1.5cqw;
          }

          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-features > i {
            display: flex;
            align-items: center;
            gap: 1.2cqw;
            width: 100%;
            height: auto;
            background-color: transparent;
            border-radius: 0;
          }

          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-features > i::before {
            content: "";
            flex: none;
            width: 2cqh;
            height: 2cqh;
            background-color: var(--ps-pricing-accent);
            border-radius: var(--pvs-radius-dot);
          }

          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-features > i::after {
            content: "";
            width: var(--pricing-feature-width, 70%);
            height: .9cqh;
            background-color: var(--pvs-bars);
            border-radius: var(--pvs-radius-bar);
          }

          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-features > i:nth-child(2) {
            --pricing-feature-width: 70%;
          }

          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-features > i:nth-child(3) {
            --pricing-feature-width: 70%;
          }

          .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-action {
            width: 100%;
            height: 5.1cqh;
            background-color: var(--ps-pricing-accent);
            border-radius: var(--pvs-radius-control);
          }

          @media (prefers-reduced-motion: reduce) {
            .picker-preview-motion[data-motion-cell="persuade-choreographed"] :is(
              .ps-eyebrow,
              .ps-headline,
              .ps-copy,
              .ps-actions,
              .ps-proof
            ) {
              opacity: 1 !important;
              filter: none !important;
              transform: none !important;
            }

            .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-choreo-track {
              transform: translateY(-50%) !important;
            }

            .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-nav {
              opacity: 0 !important;
              filter: none !important;
              transform: none !important;
            }

            .picker-preview-motion[data-motion-cell="persuade-choreographed"] .ps-pricing-card {
              opacity: 1 !important;
              filter: none !important;
              clip-path: none !important;
              transform: none !important;
            }
          }
        `;
        if (!doc.getElementById(staggerStyle.id)) doc.head.appendChild(staggerStyle);

        /* Chrome can leave this board unpainted after the style lands when the
           browser starts slowly (large profile): styles compute correctly but
           nothing paints, and the state sticks until any real style mutation.
           Nudge the sheet a few times after install to dislodge it; harmless
           when the paint was fine. */

        const board = doc.querySelector(
          '.picker-preview-motion[data-surface="persuade"]'
        );
        const desktop = board?.querySelector('.ps-desktop');

        if (desktop && !desktop.querySelector(':scope > .ps-choreo-viewport')) {
          const viewport = doc.createElement('div');
          const track = doc.createElement('div');
          const firstPage = doc.createElement('div');
          const pricingPage = doc.createElement('div');

          viewport.className = 'ps-choreo-viewport';
          track.className = 'ps-choreo-track';
          firstPage.className = 'ps-choreo-page';
          pricingPage.className = 'ps-pricing-page';
          pricingPage.setAttribute('aria-hidden', 'true');
          pricingPage.innerHTML = Array.from({ length: 3 }, () =>
            '<div class="ps-pricing-card">' +
              '<i class="ps-pricing-tier"></i>' +
              '<span class="ps-pricing-price"><b></b><i></i></span>' +
              '<i class="ps-pricing-divider"></i>' +
              '<span class="ps-pricing-features"><i></i><i></i><i></i></span>' +
              '<em class="ps-pricing-action"></em>' +
            '</div>'
          ).join('');

          [
            desktop.querySelector(':scope > .ps-hero'),
            desktop.querySelector(':scope > .ps-proof'),
            desktop.querySelector(':scope > .ps-editorial'),
            desktop.querySelector(':scope > .ps-footer')
          ].filter(Boolean).forEach((section) => firstPage.appendChild(section));

          track.append(firstPage, pricingPage);
          viewport.appendChild(track);
          desktop.querySelector(':scope > .ps-nav')
            ?.insertAdjacentElement('afterend', viewport);
        }

        const groupSelectors = [
          [
            '.ps-desktop .ps-eyebrow',
            '.ps-desktop .ps-headline',
            '.ps-desktop .ps-copy',
            '.ps-desktop .ps-actions',
            '.ps-desktop .ps-proof'
          ],
          [
            '.ps-phone-body > .ps-headline',
            '.ps-phone-body > .ps-copy',
            '.ps-phone-body > .ps-actions',
            '.ps-phone-body > .ps-proof'
          ]
        ];

        const makeSpringFrames = () => {
          const stiffness = 120;
          const damping = 20;
          const mass = 1;
          const duration = 1050;
          const steps = 72;
          const naturalFrequency = Math.sqrt(stiffness / mass);
          const dampingRatio = damping / (2 * Math.sqrt(stiffness * mass));
          const dampedFrequency = naturalFrequency * Math.sqrt(1 - dampingRatio ** 2);

          return Array.from({ length: steps + 1 }, (_, index) => {
            const offset = index / steps;
            const seconds = (duration * offset) / 1000;
            const displacement = index === steps ? 0 :
              Math.exp(-dampingRatio * naturalFrequency * seconds) *
              (
                Math.cos(dampedFrequency * seconds) +
                (dampingRatio * naturalFrequency / dampedFrequency) *
                Math.sin(dampedFrequency * seconds)
              );
            const progress = Math.max(0, Math.min(1, 1 - displacement));

            return {
              offset,
              opacity: Number(progress.toFixed(4)),
              filter: `blur(${(4 * (1 - progress)).toFixed(3)}px)`,
              transform: `translateY(${(40 * displacement).toFixed(3)}px)`
            };
          });
        };

        const motionPreference = win.matchMedia('(prefers-reduced-motion: reduce)');

        if (
          board &&
          win.Element?.prototype.animate &&
          !motionPreference.matches
        ) {
          const sequenceAnimations = [];
          const springFrames = makeSpringFrames();
          for (const selectors of groupSelectors) {
            selectors
              .map((selector) => board.querySelector(selector))
              .filter(Boolean)
              .forEach((element, index) => {
                sequenceAnimations.push(
                  element.animate(springFrames, {
                    duration: 1050,
                    delay: index * 100,
                    easing: 'linear',
                    fill: 'both'
                  })
                );
              });
          }

          const sequenceDuration = 7200;
          const scrollDownStart = 1750;
          const scrollDownEnd = 2850;
          const scrollUpStart = 5400;
          const scrollUpEnd = 6500;
          const sequenceOffset = (milliseconds) =>
            milliseconds / sequenceDuration;

          const track = board.querySelector('.ps-choreo-track');
          if (track) {
            sequenceAnimations.push(
              track.animate(
                [
                  { offset: 0, transform: 'translateY(0)' },
                  {
                    offset: sequenceOffset(scrollDownStart),
                    transform: 'translateY(0)',
                    easing: 'cubic-bezier(.65, 0, .35, 1)'
                  },
                  {
                    offset: sequenceOffset(scrollDownEnd),
                    transform: 'translateY(-50%)'
                  },
                  {
                    offset: sequenceOffset(scrollUpStart),
                    transform: 'translateY(-50%)',
                    easing: 'cubic-bezier(.65, 0, .35, 1)'
                  },
                  {
                    offset: sequenceOffset(scrollUpEnd),
                    transform: 'translateY(0)'
                  },
                  { offset: 1, transform: 'translateY(0)' }
                ],
                {
                  duration: sequenceDuration,
                  easing: 'linear',
                  fill: 'both'
                }
              )
            );
          }

          const nav = board.querySelector('.ps-desktop > .ps-nav');
          if (nav) {
            sequenceAnimations.push(
              nav.animate(
                [
                  {
                    offset: 0,
                    opacity: 1,
                    filter: 'blur(0px)',
                    transform: 'translateY(0px)'
                  },
                  {
                    offset: sequenceOffset(scrollDownStart),
                    opacity: 1,
                    filter: 'blur(0px)',
                    transform: 'translateY(0px)',
                    easing: 'cubic-bezier(.4, 0, 1, 1)'
                  },
                  {
                    offset: sequenceOffset(2200),
                    opacity: 0,
                    filter: 'blur(4px)',
                    transform: 'translateY(-10px)'
                  },
                  {
                    offset: sequenceOffset(scrollUpStart),
                    opacity: 0,
                    filter: 'blur(4px)',
                    transform: 'translateY(-10px)',
                    easing: 'cubic-bezier(.16, 1, .3, 1)'
                  },
                  {
                    offset: sequenceOffset(5850),
                    opacity: 1,
                    filter: 'blur(0px)',
                    transform: 'translateY(0px)'
                  },
                  {
                    offset: 1,
                    opacity: 1,
                    filter: 'blur(0px)',
                    transform: 'translateY(0px)'
                  }
                ],
                {
                  duration: sequenceDuration,
                  easing: 'linear',
                  fill: 'both'
                }
              )
            );
          }

          const pricingRevealFrames = {
            left: [
              {
                opacity: 0.12,
                filter: 'blur(8px)',
                clipPath: 'inset(0 100% 0 0)',
                transform: 'translateX(-64px) scale(.985)'
              },
              {
                opacity: 1,
                filter: 'blur(0px)',
                clipPath: 'inset(0)',
                transform: 'translateX(0px) scale(1)'
              }
            ],
            center: [
              {
                opacity: 0.12,
                filter: 'blur(7px)',
                clipPath: 'inset(0 49%)',
                transform: 'scale(.96)'
              },
              {
                opacity: 1,
                filter: 'blur(0px)',
                clipPath: 'inset(0)',
                transform: 'scale(1)'
              }
            ],
            right: [
              {
                opacity: 0.12,
                filter: 'blur(8px)',
                clipPath: 'inset(0 0 0 100%)',
                transform: 'translateX(64px) scale(.985)'
              },
              {
                opacity: 1,
                filter: 'blur(0px)',
                clipPath: 'inset(0)',
                transform: 'translateX(0px) scale(1)'
              }
            ]
          };
          const pricingReveals = [
            ['.ps-pricing-card:nth-child(1)', 'left', 2140],
            ['.ps-pricing-card:nth-child(2)', 'center', 2280],
            ['.ps-pricing-card:nth-child(3)', 'right', 2420]
          ];

          for (const [selector, kind, delay] of pricingReveals) {
            const card = board.querySelector(selector);
            if (!card) continue;
            sequenceAnimations.push(
              card.animate(pricingRevealFrames[kind], {
                duration: 720,
                delay,
                easing: 'cubic-bezier(.16, 1, .3, 1)',
                fill: 'both'
              })
            );
          }

          const restartSequence = () => {
            if (motionPreference.matches) {
              sequenceAnimations.forEach((animation) => animation.cancel());
              return;
            }
            sequenceAnimations.forEach((animation) => {
              animation.pause();
              animation.currentTime = 0;
              animation.play();
            });
          };

          motionBoard.__replayMotion = restartSequence;

          motionPreference.addEventListener('change', ({ matches }) => {
            if (matches) {
              sequenceAnimations.forEach((animation) => animation.cancel());
            } else {
              restartSequence();
            }
          });

          win.addEventListener('pagehide', () => {
            sequenceAnimations.forEach((animation) => animation.cancel());
          });
        }

        let nudges = 0;
        const nudge = () => {
          if (!style.isConnected || nudges >= 3) return;
          nudges += 1;
          style.textContent += '\n.imp-paint-nudge-' + nudges + ' { --imp-nudge: ' + nudges + '; }';
          if (nudges < 3) win.setTimeout(nudge, 700 * nudges);
        };
        win.requestAnimationFrame(() => win.requestAnimationFrame(nudge));
      }

    const installEmailCapture = () => {
        if (!doc?.head) return;
        if (motionBoard.hasAttribute('data-premium-landing-email-capture')) return;
        motionBoard.setAttribute('data-premium-landing-email-capture', '');

        const style = doc.createElement('style');
        style.id = 'landing-email-capture';
        style.textContent = `
          .picker-preview-motion[data-surface="persuade"] .ps-desktop .ps-editorial-copy {
            grid-template-columns: minmax(0, 1fr) !important;
            grid-template-rows: auto 20px 20px !important;
            align-items: center !important;
            column-gap: 0 !important;
            row-gap: 5px !important;
          }

          .picker-preview-motion[data-surface="persuade"] .ps-desktop .ps-editorial-copy > strong {
            grid-column: 1 / -1;
            width: 58% !important;
            height: 7px !important;
            background-color: var(--pvs-bars) !important;
          }

          .picker-preview-motion[data-surface="persuade"] .ps-desktop .ps-editorial-copy > span {
            box-sizing: border-box;
            grid-column: 1;
            grid-row: 2;
            display: flex !important;
            align-items: center;
            gap: 5px !important;
            min-width: 0;
            height: 20px;
            padding: 0 7px;
            border-radius: var(--pvs-radius-control);
            box-shadow: inset 0 0 0 1px var(--pvs-bars);
          }

          .picker-preview-motion[data-surface="persuade"] .ps-desktop .ps-editorial-copy > span i:first-child {
            box-sizing: border-box;
            flex: 0 0 auto;
            width: 6px !important;
            height: 6px !important;
            border: 1px solid var(--pvs-bars);
            border-radius: 50%;
            background: transparent !important;
          }

          .picker-preview-motion[data-surface="persuade"] .ps-desktop .ps-editorial-copy > span i:last-child {
            flex: 0 1 56%;
            width: 56% !important;
            height: 3px !important;
            border-radius: var(--pvs-radius-bar);
          }

          .picker-preview-motion[data-surface="persuade"] .ps-desktop .ps-editorial-copy > em {
            box-sizing: border-box;
            grid-column: 1;
            grid-row: 3;
            position: relative;
            width: 100% !important;
            height: 20px !important;
            margin: 0 !important;
            border-radius: var(--pvs-radius-control);
            background-color: var(--pvs-ghost);
            box-shadow: inset 0 0 0 1px var(--pvs-cta);
            transform-origin: 50% 50%;
          }

          .picker-preview-motion[data-surface="persuade"] .ps-desktop .ps-editorial-copy > em::after,
          .picker-preview-motion[data-surface="persuade"] .ps-desktop .ps-editorial-copy > em::before {
            content: "";
            box-sizing: border-box;
            position: absolute;
            top: 50%;
            left: 50%;
            pointer-events: none;
          }

          .picker-preview-motion[data-surface="persuade"] .ps-desktop .ps-editorial-copy > em::after {
            width: 10px;
            height: 8px;
            background-color: var(--pvs-cta);
            clip-path: polygon(0 0, 100% 50%, 0 100%, 22% 59%, 68% 50%, 22% 41%);
            transform: translate(-50%, -50%);
          }

          .picker-preview-motion[data-surface="persuade"] .ps-desktop .ps-editorial-copy > em::before {
            width: 5px;
            height: 8px;
            border-right: 1.5px solid var(--pvs-cta-text);
            border-bottom: 1.5px solid var(--pvs-cta-text);
            opacity: 0;
            transform: translate(-50%, -62%) rotate(45deg) scale(.7);
          }

          .picker-preview-motion[data-motion-cell="persuade-responsive"] .ps-gallery-item:first-child > i,
          .picker-preview-motion[data-motion-cell="persuade-responsive"] .ps-gallery-item:first-child span b:first-child,
          .picker-preview-motion[data-motion-cell="persuade-responsive"] .ps-gallery-item:first-child > i::after {
            animation: none !important;
          }

          .picker-preview-motion[data-motion-cell="persuade-responsive"] .ps-gallery-item:first-child > i::after {
            opacity: 0 !important;
          }

          .picker-preview-motion[data-motion-cell="persuade-responsive"] .ps-editorial-copy > em {
            animation:
              mt-in-4 var(--mt) var(--mt-ease) infinite,
              mtv-email-submit 4.2s linear infinite !important;
          }

          .picker-preview-motion[data-motion-cell="persuade-responsive"] .ps-editorial-copy > em::after {
            animation: mtv-email-send 4.2s linear infinite;
          }

          .picker-preview-motion[data-motion-cell="persuade-responsive"] .ps-editorial-copy > em::before {
            animation: mtv-email-check 4.2s linear infinite;
          }

          .picker-preview-motion[data-motion-cell="persuade-responsive"] .ps-cursor::after {
            animation: mtv-email-click 4.2s linear infinite !important;
          }

          /* The cursor path keyframes (mtr-/mtv-path-perfect-loop) are owned by
             the per-cell correction styles; do not redefine them here. */

          @keyframes mtv-email-submit {
            0%, 63% {
              background-color: var(--pvs-ghost);
              box-shadow: inset 0 0 0 1px var(--pvs-cta);
              scale: 1;
            }
            65% {
              background-color: var(--pvs-ghost);
              box-shadow: inset 0 0 0 1px var(--pvs-cta);
              scale: .9;
            }
            69%, 83.33% {
              background-color: var(--pvs-cta);
              box-shadow: var(--pvs-shadow-control);
              scale: 1;
            }
            88%, 100% {
              background-color: var(--pvs-ghost);
              box-shadow: inset 0 0 0 1px var(--pvs-cta);
              scale: 1;
            }
          }

          @keyframes mtv-email-send {
            0%, 63% {
              opacity: 1;
              transform: translate(-50%, -50%) scale(1);
            }
            66%, 84% {
              opacity: 0;
              transform: translate(-18%, -50%) scale(.72);
            }
            88%, 100% {
              opacity: 1;
              transform: translate(-50%, -50%) scale(1);
            }
          }

          @keyframes mtv-email-check {
            0%, 66% {
              opacity: 0;
              transform: translate(-50%, -62%) rotate(45deg) scale(.7);
            }
            69%, 83.33% {
              opacity: 1;
              transform: translate(-50%, -62%) rotate(45deg) scale(1);
            }
            88%, 100% {
              opacity: 0;
              transform: translate(-50%, -62%) rotate(45deg) scale(.7);
            }
          }

          @keyframes mtv-email-click {
            0%, 63.5% {
              opacity: 0;
              scale: .35;
            }
            64% {
              opacity: .55;
              scale: .35;
            }
            67%, 100% {
              opacity: 0;
              scale: 1.5;
            }
          }

          @media (prefers-reduced-motion: reduce) {
            .picker-preview-motion[data-surface="persuade"] .ps-editorial-copy > em,
            .picker-preview-motion[data-surface="persuade"] .ps-editorial-copy > em::before,
            .picker-preview-motion[data-surface="persuade"] .ps-editorial-copy > em::after {
              animation: none !important;
            }
          }
        `;
        if (!doc.getElementById(style.id)) doc.head.appendChild(style);

        const getEmailTarget = () => doc.querySelector(
          '.picker-preview-motion[data-surface="persuade"] .ps-desktop .ps-editorial-copy > em'
        );

        const plotEmailTarget = () => {
          const target = getEmailTarget();
          const board = target?.closest('.picker-preview-motion');
          const desk = target?.closest('.ps-desktop');
          const cursor = board?.querySelector('.ps-cursor');
          if (!board || !desk || !target || !cursor) return;

          const deskRect = desk.getBoundingClientRect();
          const targetRect = target.getBoundingClientRect();
          if (!desk.clientWidth || !desk.clientHeight) return;

          const deskStyle = win.getComputedStyle(desk);
          const iconStyle = win.getComputedStyle(target, '::after');
          const cursorStyle = win.getComputedStyle(cursor);
          const borderLeft = parseFloat(deskStyle.borderLeftWidth) || 0;
          const borderTop = parseFloat(deskStyle.borderTopWidth) || 0;
          const resolveInset = (value, size) => {
            const amount = parseFloat(value);
            if (!Number.isFinite(amount)) return size / 2;
            return value.trim().endsWith('%') ? (amount / 100) * size : amount;
          };
          const iconX = resolveInset(iconStyle.left, targetRect.width);
          const iconY = resolveInset(iconStyle.top, targetRect.height);
          const cursorWidth = parseFloat(cursorStyle.width) || cursor.offsetWidth;
          const cursorHeight = parseFloat(cursorStyle.height) || cursor.offsetHeight;
          const cursorScale = Math.min(cursorWidth / 14, cursorHeight / 20);
          // The SVG's geometric apex sits at (1,1)*scale, but its white outline
          // disappears against the light button, so the eye reads the black wedge
          // (which starts ~1px right and ~2px below the apex) as the tip. Aim
          // that visible wedge at the icon center instead of the apex.
          const cursorHotspotX = cursorScale * 2.2;
          const cursorHotspotY = cursorScale * 3.9;
          const x = ((targetRect.left - deskRect.left - borderLeft + iconX - cursorHotspotX) / desk.clientWidth) * 100;
          const y = ((targetRect.top - deskRect.top - borderTop + iconY - cursorHotspotY) / desk.clientHeight) * 100;
          board.style.setProperty('--mtr-email', `${x.toFixed(2)}cqw ${y.toFixed(2)}cqh`);
        };

        win.requestAnimationFrame(() => {
          plotEmailTarget();
          win.requestAnimationFrame(plotEmailTarget);
        });

        const emailTarget = getEmailTarget();
        const desk = emailTarget?.closest('.ps-desktop');
        if (desk && win.ResizeObserver) {
          const observer = new win.ResizeObserver(plotEmailTarget);
          observer.observe(desk);
          motionBoard.__emailCaptureObserver = observer;
        }
      }

    const installPortfolioFixes = () => {
        if (!doc?.head) return;
        if (motionBoard.hasAttribute('data-premium-portfolio-motion-fixes')) return;
        motionBoard.setAttribute('data-premium-portfolio-motion-fixes', '');

        const style = doc.createElement('style');
        style.id = 'portfolio-motion-fixes';
        style.textContent = `
          /* ============================================================
             A. Preview 48's rendered gallery topology. Its desktop artifact
             leads; the phone is a static supporting adaptation. The current
             palette remains mapped through the existing --pv-* properties.
             ============================================================ */
          .picker-preview-motion[data-surface="experience"] {
            --pvs-title: var(--pg-ink);
            --pvs-cta: var(--pv-primary);
            --pvs-bars: var(--pg-ink);
            --pvs-accent-d: var(--pv-primary);
            --pvs-ink: var(--pv-n-ink);
            grid-row: 2;
            width: 100%;
            height: 100%;
            aspect-ratio: auto;
          }
          .picker-preview-motion[data-surface="experience"] .pv-desktop {
            --pv-text: 1.35;
            position: relative;
            container-type: size;
          }
          .picker-preview-motion[data-surface="experience"] .pv-desktop .pv-pill {
            color: var(--pv-neutral);
            display: grid;
            place-items: center;
          }
          .picker-preview-motion[data-surface="experience"] .pv-desktop .pv-pill::after {
            content: "";
            width: calc(8.5 * var(--pv-x));
            height: calc(1.3 * var(--pv-x));
            background: currentColor;
            border-radius: 2px;
          }
          .picker-preview-motion[data-surface="experience"] .pv-desktop .pg-cap {
            padding-top: 5.2cqh !important;
            gap: 2.6cqh !important;
          }
          .picker-preview-motion[data-surface="experience"] .pv-desktop .pg-cap::before {
            content: "";
            display: block;
            width: calc(11.5 * var(--pv-x));
            aspect-ratio: 1;
            border: 1px solid color-mix(in oklab, var(--pv-secondary) 55%, var(--pv-neutral));
            border-radius: 50%;
            background: linear-gradient(
              135deg,
              color-mix(in oklab, var(--pv-secondary) 24%, var(--pv-neutral)),
              color-mix(in oklab, var(--pv-secondary) 46%, var(--pv-neutral))
            );
          }
          .picker-preview-motion[data-surface="experience"] :is(.pg-row--flip, .pg-rail) {
            border-color: transparent !important;
            box-shadow: none !important;
          }

          /* Existing motion is remapped onto Preview 48's desktop-only hooks. */
          .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pv-nav-bars i:first-child {
            animation: 3.8s linear infinite mtr-nav-1;
          }
          .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pg-row:first-child .pg-cap-title {
            animation: 3.8s linear infinite mxr-name-1;
          }
          .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pg-row:first-child > .pv-image::after {
            animation: 3.8s linear infinite mxr-mark-1;
          }
          .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pg-row:nth-child(2) .pg-cap-title {
            animation: 3.8s linear infinite mxr-name-2;
          }
          .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pg-row:nth-child(2) > .pv-image::after {
            animation: 3.8s linear infinite mxr-mark-2;
          }

          .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pv-nav-bars i:first-child {
            animation: 4.2s linear infinite mxv-nav-1;
          }
          .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-row:first-child .pg-cap-title {
            animation: 4.2s linear infinite mxv-name;
          }
          .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-row:first-child > .pv-image::after {
            animation: 4.2s linear infinite mxv-mark;
          }
          .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-arrow--next {
            animation: 4.2s linear infinite mxv-arrow;
          }
          .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-track {
            animation: 4.2s linear infinite mxv-track;
          }
          .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-track i:first-child {
            animation: 4.2s linear infinite mxv-stop-off;
          }
          .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-track i:nth-child(2) {
            animation: 4.2s linear infinite mxv-stop-on;
          }

          /* Choreographed keeps every project visible. Focus travels through the
             existing image, caption, marker, and pagination controls with bounded
             blur and transform motion; no component is revealed from opacity 0. */
          .picker-preview-motion[data-motion-cell="experience-choreographed"] .ps-cursor {
            animation: 5.6s linear infinite pgc-path !important;
          }
          .picker-preview-motion[data-motion-cell="experience-choreographed"] .ps-cursor::after {
            animation: none !important;
            opacity: 0 !important;
          }
          .picker-preview-motion[data-motion-cell="experience-choreographed"] .pv-desktop .pv-nav-bars i:first-child {
            animation: 5.6s linear infinite pgc-nav;
          }
          .picker-preview-motion[data-motion-cell="experience-choreographed"] .pv-desktop .pg-row:first-child > .pv-image {
            transform-origin: 50% 50%;
            animation: 5.6s linear infinite pgc-image-1;
          }
          .picker-preview-motion[data-motion-cell="experience-choreographed"] .pv-desktop .pg-row:first-child .pg-cap {
            animation: 5.6s linear infinite pgc-cap-1;
          }
          .picker-preview-motion[data-motion-cell="experience-choreographed"] .pv-desktop .pg-row:first-child .pg-cap-title {
            animation: 5.6s linear infinite pgc-name-1;
          }
          .picker-preview-motion[data-motion-cell="experience-choreographed"] .pv-desktop .pg-row:first-child > .pv-image::after {
            animation: 5.6s linear infinite pgc-mark-1;
          }
          .picker-preview-motion[data-motion-cell="experience-choreographed"] .pv-desktop .pg-arrow--next {
            animation: 5.6s linear infinite pgc-arrow;
          }
          .picker-preview-motion[data-motion-cell="experience-choreographed"] .pv-desktop .pg-track i:first-child {
            animation: 5.6s linear infinite pgc-stop-off;
          }
          .picker-preview-motion[data-motion-cell="experience-choreographed"] .pv-desktop .pg-track i:nth-child(2) {
            animation: 5.6s linear infinite pgc-stop-on;
          }
          .picker-preview-motion[data-motion-cell="experience-choreographed"] .pv-desktop .pg-row:nth-child(2) > .pv-image {
            transform-origin: 50% 50%;
            animation: 5.6s linear infinite pgc-image-2;
          }
          .picker-preview-motion[data-motion-cell="experience-choreographed"] .pv-desktop .pg-row:nth-child(2) .pg-cap {
            animation: 5.6s linear infinite pgc-cap-2;
          }
          .picker-preview-motion[data-motion-cell="experience-choreographed"] .pv-desktop .pg-row:nth-child(2) .pg-cap-title {
            animation: 5.6s linear infinite pgc-name-2;
          }
          .picker-preview-motion[data-motion-cell="experience-choreographed"] .pv-desktop .pg-row:nth-child(2) > .pv-image::after {
            animation: 5.6s linear infinite pgc-mark-2;
          }

          /* ============================================================
             B. Restrained cell (3.8s linear cycle).
             New route: entry -> nav1 (one nav hover only) -> work1 -> work2 -> exit.
             The -tip variables are set by plotIndexTips() below; fallbacks
             are the precomputed tip-compensated stops.
             ============================================================ */
          @keyframes mxr-path {
            0% { translate: var(--mtr-entry, 62.73cqw -8cqh); }
            9.21%, 30% { translate: var(--mxi-nav1-tip, 62.4cqw 3.9cqh); }
            45%, 62% { translate: var(--mxi-work1-tip, 24.5cqw 33.8cqh); }
            72%, 88% { translate: var(--mxi-work2-tip, 77.3cqw 66.8cqh); }
            96.5%, 100% { translate: var(--mtr-entry, 62.73cqw -8cqh); }
          }
          /* Nav 1 highlight + dropdown follow the longer nav dwell. */
          @keyframes mtr-nav-1 {
            0%, 9.2% { background-color: var(--pvs-bars); }
            9.21%, 29.99% { background-color: var(--pvs-cta); }
            30%, 100% { background-color: var(--pvs-bars); }
          }
          @keyframes mtr-drop-1 {
            0%, 9.2% { opacity: 0; }
            9.21%, 29.99% { opacity: 1; }
            30%, 100% { opacity: 0; }
          }
          /* Nav 2 never hovers: pin its highlight and dropdown to rest. */
          @keyframes mtr-nav-2 {
            0%, 100% { background-color: var(--pvs-bars); }
          }
          @keyframes mtr-drop-2 {
            0%, 100% { opacity: 0; }
          }
          /* Work-row hovers retimed to the new dwells (45-62 and 72-88).
             Name bars keep Preview 48's ink at rest and use the existing primary
             only while the cursor is actually over that project. */
          @keyframes mxr-name-1 {
            0%, 44.99% { background-color: var(--pg-ink); }
            45%, 61.99% { background-color: var(--pv-primary); }
            62%, 100% { background-color: var(--pg-ink); }
          }
          @keyframes mxr-mark-1 {
            0%, 44.99% { background-color: var(--pvs-accent-d); scale: 1; }
            45%, 61.99% { background-color: var(--pvs-cta); scale: 1.4; }
            62%, 100% { background-color: var(--pvs-accent-d); scale: 1; }
          }
          @keyframes mxr-name-2 {
            0%, 71.99% { background-color: var(--pg-ink); }
            72%, 87.99% { background-color: var(--pv-primary); }
            88%, 100% { background-color: var(--pg-ink); }
          }
          @keyframes mxr-mark-2 {
            0%, 71.99% { background-color: var(--pvs-accent-d); scale: 1; }
            72%, 87.99% { background-color: var(--pvs-cta); scale: 1.4; }
            88%, 100% { background-color: var(--pvs-accent-d); scale: 1; }
          }

          /* ============================================================
             C. Responsive cell (4.2s cycle). Ground nav/work windows are
             kept (their companion animations already align); the rail
             dwell is extended to 86% so the click -> slide -> swap story
             completes while the cursor is still on the arrow.
             ============================================================ */
          @keyframes mxv-path {
            0% { translate: var(--mtr-entry, 62.73cqw -8cqh); }
            5.95%, 25% { translate: var(--mxi-nav1-tip, 62.4cqw 3.9cqh); }
            34.52%, 50% { translate: var(--mxi-work1-tip, 24.5cqw 33.8cqh); }
            60.71%, 86% { translate: var(--mxi-rail-tip, 96.0cqw 85.4cqh); }
            92%, 99.99% { translate: 32cqw 115cqh; }
            100% { translate: var(--mtr-entry, 62.73cqw -8cqh); }
          }
          @keyframes mxv-nav-1 {
            0%, 5.94% { background-color: var(--pvs-bars); }
            5.95%, 24.99% { background-color: var(--pvs-cta); }
            25%, 100% { background-color: var(--pvs-bars); }
          }
          /* Name bar: same window as ground mxv-name, new rest color. */
          @keyframes mxv-name {
            0%, 34.51% { background-color: var(--pg-ink); animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            38.33%, 50% { background-color: var(--pv-primary); }
            52.86%, 100% { background-color: var(--pg-ink); }
          }
          /* Pagination advances AFTER the click ring (click at ~63%,
             slide + swap 66.5 -> 70). */
          @keyframes mxv-track {
            0%, 66.49% { translate: 0; animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            70%, 99.99% { translate: -6px; }
            100% { translate: 0; }
          }
          @keyframes mxv-stop-off {
            0%, 66.49% { background-color: var(--pvs-cta); animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            70%, 99.99% { background-color: var(--pvs-bars); }
            100% { background-color: var(--pvs-cta); }
          }
          @keyframes mxv-stop-on {
            0%, 66.49% { background-color: var(--pvs-bars); animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            70%, 99.99% { background-color: var(--pvs-cta); }
            100% { background-color: var(--pvs-bars); }
          }

          /* ============================================================
             D. Choreographed cell (5.6s cycle). A closed cursor circuit and
             non-destructive focus choreography. Every element remains visible.
             ============================================================ */
          @keyframes pgc-path {
            0%, 14% { translate: var(--mxi-nav1-tip, 62.4cqw 3.9cqh); }
            22%, 38% { translate: var(--mxi-work1-tip, 24.5cqw 33.8cqh); }
            48%, 64% { translate: var(--mxi-rail-tip, 96cqw 85.4cqh); }
            74%, 88% { translate: var(--mxi-work2-tip, 77.3cqw 66.8cqh); }
            100% { translate: var(--mxi-nav1-tip, 62.4cqw 3.9cqh); }
          }
          @keyframes pgc-nav {
            0%, 14% { background-color: var(--pv-primary); }
            18%, 100% { background-color: var(--pg-ink); }
          }
          @keyframes pgc-image-1 {
            0%, 18% { filter: blur(0) saturate(1); scale: 1; clip-path: inset(0); }
            22% { filter: blur(.8px) saturate(.98); scale: 1.006; clip-path: inset(0); animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            28%, 36% { filter: blur(0) saturate(1.04); scale: 1.012; clip-path: inset(0); }
            42%, 100% { filter: blur(0) saturate(1); scale: 1; clip-path: inset(0); }
          }
          @keyframes pgc-cap-1 {
            0%, 18% { filter: blur(0); translate: 0 0; opacity: 1; }
            22% { filter: blur(.7px); translate: 0 1.5px; opacity: 1; animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            28%, 36% { filter: blur(0); translate: 0 0; opacity: 1; }
            42%, 100% { filter: blur(0); translate: 0 0; opacity: 1; }
          }
          @keyframes pgc-name-1 {
            0%, 21.99% { background-color: var(--pg-ink); }
            28%, 36% { background-color: var(--pv-primary); }
            42%, 100% { background-color: var(--pg-ink); }
          }
          @keyframes pgc-mark-1 {
            0%, 21.99% { scale: 1; }
            28%, 36% { scale: 1.35; }
            42%, 100% { scale: 1; }
          }
          @keyframes pgc-arrow {
            0%, 47.99% { translate: 0; filter: blur(0); }
            53%, 60% { translate: 1.5px 0; filter: blur(0); animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            66%, 100% { translate: 0; filter: blur(0); }
          }
          @keyframes pgc-stop-off {
            0%, 52% { background-color: var(--pv-primary); scale: 1; }
            58%, 64% { background-color: var(--pg-ink); scale: .82; }
            70%, 100% { background-color: var(--pv-primary); scale: 1; }
          }
          @keyframes pgc-stop-on {
            0%, 52% { background-color: var(--pg-ink); scale: 1; }
            58%, 64% { background-color: var(--pv-primary); scale: 1.18; }
            70%, 100% { background-color: var(--pg-ink); scale: 1; }
          }
          @keyframes pgc-image-2 {
            0%, 70% { filter: blur(0) saturate(1); scale: 1; clip-path: inset(0); }
            74% { filter: blur(.8px) saturate(.98); scale: 1.006; clip-path: inset(0); animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            80%, 88% { filter: blur(0) saturate(1.04); scale: 1.012; clip-path: inset(0); }
            94%, 100% { filter: blur(0) saturate(1); scale: 1; clip-path: inset(0); }
          }
          @keyframes pgc-cap-2 {
            0%, 70% { filter: blur(0); translate: 0 0; opacity: 1; }
            74% { filter: blur(.7px); translate: 0 1.5px; opacity: 1; animation-timing-function: cubic-bezier(.16, 1, .3, 1); }
            80%, 88% { filter: blur(0); translate: 0 0; opacity: 1; }
            94%, 100% { filter: blur(0); translate: 0 0; opacity: 1; }
          }
          @keyframes pgc-name-2 {
            0%, 73.99% { background-color: var(--pg-ink); }
            80%, 88% { background-color: var(--pv-primary); }
            94%, 100% { background-color: var(--pg-ink); }
          }
          @keyframes pgc-mark-2 {
            0%, 73.99% { scale: 1; }
            80%, 88% { scale: 1.35; }
            94%, 100% { scale: 1; }
          }

          /* ============================================================
             E. Click ring. Restrained starts from a quiet default here; its
             modal sequence below owns the two intentional clicks. Responsive
             clicks once on the next-arrow before pagination advances.
             (Keyframes are document-global, so the per-cell split lives in
             these scoped assignment rules.)
             ============================================================ */
          .picker-preview-motion[data-motion-cell="experience-restrained"] .ps-cursor::after {
            animation: none;
            opacity: 0;
          }
          .picker-preview-motion[data-motion-cell="experience-responsive"] .ps-cursor::after {
            animation: 4.2s linear infinite mxi-rail-click !important;
          }
          @keyframes mxi-rail-click {
            0%, 62.49% { opacity: 0; scale: .35; }
            62.9% { opacity: .55; scale: .35; }
            65.3% { opacity: 0; scale: 1.5; }
            100% { opacity: 0; scale: 1.5; }
          }

          @media (prefers-reduced-motion: reduce) {
            .picker-preview-motion[data-surface="experience"] .ps-cursor::after {
              animation: none !important;
              opacity: 0 !important;
            }
            .picker-preview-motion[data-surface="experience"] .pv-desktop :is(
              .pv-nav-bars i,
              .pv-image,
              .pv-image::before,
              .pv-image::after,
              .pg-cap,
              .pg-cap-title,
              .pg-arrow,
              .pg-track,
              .pg-track i
            ) {
              animation: none !important;
              opacity: 1 !important;
              clip-path: none !important;
              filter: none !important;
              translate: none !important;
              scale: 1 !important;
            }
            .picker-preview-motion[data-motion-cell="experience-choreographed"] .ps-cursor {
              animation: none !important;
              translate: var(--mxi-nav1-tip, 62.4cqw 3.9cqh) !important;
            }
          }
        `;
        if (!doc.getElementById(style.id)) doc.head.appendChild(style);

        if (cell.slice(cell.indexOf('-') + 1) === 'restrained') {
          const loopStyle = doc.createElement('style');
          loopStyle.id = 'restrained-portfolio-perfect-loop';
          loopStyle.textContent = `
            /* Preview 29's whole story is one closed interaction loop:
               nav dropdown -> first gallery image -> modal -> close -> nav. */
            .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pv-nav {
              position: relative;
              z-index: 3;
            }
            .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pv-nav-bars i:first-child {
              position: relative;
              animation: 4s linear infinite mxr-modal-nav !important;
            }
            .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pv-nav-bars i:first-child::after {
              content: "";
              box-sizing: border-box;
              width: 64px;
              height: 54px;
              position: absolute;
              z-index: 4;
              top: calc(100% + 8px);
              left: -10px;
              transform-origin: top;
              pointer-events: none;
              border: 1.5px solid var(--pv-primary);
              border-radius: 2px;
              background: var(--pv-neutral);
              opacity: 0;
              animation: 4s linear infinite mxr-modal-dropdown;
            }
            .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pv-nav-bars i:first-child::before {
              content: "";
              width: 41px;
              height: 31px;
              position: absolute;
              z-index: 5;
              top: calc(100% + 18.5px);
              left: 1.5px;
              pointer-events: none;
              background-image:
                linear-gradient(var(--pg-ink), var(--pg-ink)),
                linear-gradient(var(--pg-ink), var(--pg-ink)),
                linear-gradient(var(--pg-ink), var(--pg-ink));
              background-position: 0 0, 0 13px, 0 26px;
              background-repeat: no-repeat;
              background-size: 78% 5px, 92% 5px, 64% 5px;
              opacity: 0;
              animation: 4s linear infinite mxr-modal-dropdown;
            }

            .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .ps-cursor {
              z-index: 15;
              animation: 4s cubic-bezier(.16, 1, .3, 1) infinite mxr-modal-path !important;
            }

            .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .ps-cursor::after {
              left: -7.95px !important;
              top: -7.95px !important;
              animation: 4s linear infinite mxr-modal-click !important;
            }

            .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pg-row .pg-cap-title,
            .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pg-row > .pv-image::after {
              animation: none !important;
            }

            .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pg-row .pg-cap-title {
              background-color: var(--pg-ink) !important;
            }

            .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .mxr-modal-scene {
              display: block;
              position: absolute;
              z-index: 8;
              inset: 0;
              overflow: hidden;
              pointer-events: none;
            }

            .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .mxr-modal-backdrop {
              display: block;
              position: absolute;
              inset: 0;
              background: color-mix(in oklab, var(--pv-neutral) 52%, transparent);
              opacity: 0;
              -webkit-backdrop-filter: blur(0);
              backdrop-filter: blur(0);
              animation: 4s linear infinite mxr-modal-backdrop;
            }

            .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .mxr-modal-surface {
              display: block;
              box-sizing: border-box;
              position: absolute;
              inset: 13cqh 12cqw 12cqh;
              overflow: hidden;
              padding: 7cqh 4cqw 4.2cqh;
              border: 1px solid color-mix(in oklab, var(--pv-secondary) 58%, var(--pv-neutral));
              background: var(--pv-neutral);
              opacity: 0;
              animation: 4s linear infinite mxr-modal-surface;
            }

            .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .mxr-modal-close {
              display: grid;
              place-items: center;
              box-sizing: border-box;
              width: 4cqw;
              aspect-ratio: 1;
              position: absolute;
              z-index: 2;
              top: 2.3cqh;
              right: 1.8cqw;
              border: 0;
              background: transparent;
              box-shadow: none;
              color: var(--pv-primary);
              animation: 4s linear infinite mxr-modal-close-press;
            }

            .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .mxr-modal-close::before,
            .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .mxr-modal-close::after {
              content: "";
              width: 48%;
              height: 1px;
              position: absolute;
              left: 50%;
              top: 50%;
              translate: -50% -50%;
              background: currentColor;
            }

            .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .mxr-modal-close::before {
              rotate: 45deg;
            }

            .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .mxr-modal-close::after {
              rotate: -45deg;
            }

            .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .mxr-modal-bento {
              display: grid;
              width: 100%;
              height: 100%;
              grid-template-columns: 1.2fr .8fr .8fr;
              grid-template-rows: 1fr 1fr;
              gap: 2.1cqw;
            }

            .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .mxr-modal-image {
              display: block !important;
              width: 100% !important;
              height: 100% !important;
              min-width: 0;
              min-height: 0;
            }

            .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .mxr-modal-image--hero {
              grid-row: 1 / 3;
            }

            .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .mxr-modal-image--wide {
              grid-column: 2 / 4;
            }

            @keyframes mxr-modal-path {
              0%, 6% {
                translate: var(--mxi-nav1-tip, 69.15cqw 5.47cqh);
              }
              18%, 25.5% {
                translate: var(--mxi-work1-tip, 33cqw 29.74cqh);
              }
              38%, 76% {
                translate: var(--mxr-modal-close-tip, 83.88cqw 17.95cqh);
              }
              88.5%, 100% {
                translate: var(--mxi-nav1-tip, 69.15cqw 5.47cqh);
              }
            }

            @keyframes mxr-modal-nav {
              0%, 6% { background-color: var(--pvs-cta); }
              9%, 85.5% { background-color: var(--pvs-bars); }
              88.5%, 100% { background-color: var(--pvs-cta); }
            }

            @keyframes mxr-modal-dropdown {
              0%, 6% { opacity: 1; }
              9%, 85.5% { opacity: 0; }
              88.5%, 100% { opacity: 1; }
            }

            @keyframes mxr-modal-click {
              0%, 20.99% { opacity: 0; scale: .35; }
              21% { opacity: .55; scale: .35; }
              25.5% { opacity: 0; scale: 1.5; }
              25.51%, 71.49% { opacity: 0; scale: .35; }
              71.5% { opacity: .55; scale: .35; }
              76% { opacity: 0; scale: 1.5; }
              76.01%, 100% { opacity: 0; scale: .35; }
            }

            @keyframes mxr-modal-backdrop {
              0%, 25.49% {
                opacity: 0;
                -webkit-backdrop-filter: blur(0);
                backdrop-filter: blur(0);
              }
              25.5% {
                opacity: 0;
                -webkit-backdrop-filter: blur(0);
                backdrop-filter: blur(0);
                animation-timing-function: cubic-bezier(.16, 1, .3, 1);
              }
              38%, 75.99% {
                opacity: 1;
                -webkit-backdrop-filter: blur(3px);
                backdrop-filter: blur(3px);
              }
              76% {
                opacity: 1;
                -webkit-backdrop-filter: blur(3px);
                backdrop-filter: blur(3px);
                animation-timing-function: cubic-bezier(.4, 0, 1, 1);
              }
              86%, 100% {
                opacity: 0;
                -webkit-backdrop-filter: blur(0);
                backdrop-filter: blur(0);
              }
            }

            @keyframes mxr-modal-surface {
              0%, 25.49% {
                opacity: 0;
                clip-path: inset(9% 7% 9% 7%);
                filter: blur(7px);
                scale: 1;
              }
              25.5% {
                opacity: 0;
                clip-path: inset(9% 7% 9% 7%);
                filter: blur(7px);
                scale: 1;
                animation-timing-function: cubic-bezier(.16, 1, .3, 1);
              }
              38%, 75.99% {
                opacity: 1;
                clip-path: inset(0);
                filter: blur(0);
                scale: 1;
              }
              76% {
                opacity: 1;
                clip-path: inset(0);
                filter: blur(0);
                scale: 1;
                animation-timing-function: cubic-bezier(.4, 0, 1, 1);
              }
              86% {
                opacity: 0;
                clip-path: inset(3%);
                filter: blur(4px);
                scale: 1;
              }
              86.01%, 100% {
                opacity: 0;
                clip-path: inset(9% 7% 9% 7%);
                filter: blur(7px);
                scale: 1;
              }
            }

            @keyframes mxr-modal-close-press {
              0%, 71.49% { scale: 1; }
              73.25% { scale: .82; }
              76%, 100% { scale: 1; }
            }

            @media (prefers-reduced-motion: reduce) {
              .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pv-nav-bars i:first-child::before,
              .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pv-nav-bars i:first-child::after {
                animation: none !important;
                opacity: 1 !important;
                scale: 1 !important;
              }

              .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .ps-cursor::after {
                animation: none !important;
                opacity: 0 !important;
                scale: 1 0 !important;
              }

              .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pv-nav-bars i:first-child,
              .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .ps-cursor {
                animation: none !important;
              }

              .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .pv-nav-bars i:first-child {
                background-color: var(--pvs-cta) !important;
              }

              .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .ps-cursor {
                translate: var(--mxi-nav1-tip, 62.4cqw 3.9cqh) !important;
              }

              .picker-preview-motion[data-motion-cell="experience-restrained"] .pv-desktop .mxr-modal-scene {
                display: none !important;
              }
            }
          `;

          const board = doc.querySelector('.picker-preview-motion--index');
          const desktop = board?.querySelector('.pv-desktop');

          if (desktop && !desktop.querySelector('.mxr-modal-scene')) {
            desktop.insertAdjacentHTML(
              'beforeend',
              '<span class="mxr-modal-scene" aria-hidden="true">' +
                '<span class="mxr-modal-backdrop"></span>' +
                '<span class="mxr-modal-surface">' +
                  '<i class="mxr-modal-close"></i>' +
                  '<span class="mxr-modal-bento">' +
                    '<i class="pv-image mxr-modal-image mxr-modal-image--hero"></i>' +
                    '<i class="pv-image mxr-modal-image mxr-modal-image--wide"></i>' +
                    '<i class="pv-image mxr-modal-image"></i>' +
                    '<i class="pv-image mxr-modal-image"></i>' +
                  '</span>' +
                '</span>' +
              '</span>'
            );
          }

          if (!doc.getElementById(loopStyle.id)) doc.head.appendChild(loopStyle);
        }

        if (cell.slice(cell.indexOf('-') + 1) === 'responsive') {
          const loopStyle = doc.createElement('style');
          loopStyle.id = 'responsive-portfolio-perfect-loop';
          loopStyle.textContent = `
            /* Preview 30 keeps preview 27's responsive dropdown, then follows
               one focused interaction: first gallery image -> modal -> close. */
            .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pv-nav {
              position: relative;
              z-index: 3;
            }
            .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pv-nav-bars i:first-child {
              position: relative;
              animation: 4.2s linear infinite mxv-modal-nav !important;
            }
            .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pv-nav-bars i:first-child::after {
              content: "";
              box-sizing: border-box;
              width: 64px;
              height: 54px;
              position: absolute;
              z-index: 4;
              top: calc(100% + 8px);
              left: -10px;
              transform-origin: top;
              pointer-events: none;
              border: 1.5px solid var(--pv-primary);
              border-radius: 2px;
              background: var(--pv-neutral);
              opacity: 0;
              animation: 4.2s linear infinite mxv-drop-panel;
            }
            .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pv-nav-bars i:first-child::before {
              content: "";
              width: 41px;
              height: 31px;
              position: absolute;
              z-index: 5;
              top: calc(100% + 18.5px);
              left: 1.5px;
              pointer-events: none;
              background-image:
                linear-gradient(var(--pg-ink), var(--pg-ink)),
                linear-gradient(var(--pg-ink), var(--pg-ink)),
                linear-gradient(var(--pg-ink), var(--pg-ink));
              background-position: 0 -6px, 0 7px, 0 20px;
              background-repeat: no-repeat;
              background-size: 78% 5px, 92% 5px, 64% 5px;
              opacity: 0;
              animation: 4.2s linear infinite mxv-drop-rows;
            }

            .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .ps-cursor {
              z-index: 15;
              animation: 4.2s linear infinite mxv-modal-path !important;
            }

            .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .ps-cursor::after {
              left: -7.95px !important;
              top: -7.95px !important;
              animation: 4.2s linear infinite mxv-modal-click !important;
            }

            .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-row .pg-cap-title,
            .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-row > .pv-image::after,
            .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-arrow--next,
            .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-track,
            .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-track i {
              animation: none !important;
            }

            .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-row .pg-cap-title {
              background-color: var(--pg-ink) !important;
            }

            .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-track {
              translate: 0 !important;
            }

            .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-track i:first-child {
              background-color: var(--pvs-cta) !important;
            }

            .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pg-track i:not(:first-child) {
              background-color: var(--pvs-bars) !important;
            }

            .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-scene {
              display: block;
              position: absolute;
              z-index: 8;
              inset: 0;
              overflow: hidden;
              pointer-events: none;
            }

            .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-backdrop {
              display: block;
              position: absolute;
              inset: 0;
              background: color-mix(in oklab, var(--pv-neutral) 52%, transparent);
              opacity: 0;
              -webkit-backdrop-filter: blur(0);
              backdrop-filter: blur(0);
              animation: 4.2s linear infinite mxv-modal-backdrop;
            }

            .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-surface {
              display: block;
              box-sizing: border-box;
              position: absolute;
              inset: 13cqh 12cqw 12cqh;
              overflow: hidden;
              padding: 7cqh 4cqw 4.2cqh;
              border: 1px solid color-mix(in oklab, var(--pv-secondary) 58%, var(--pv-neutral));
              background: var(--pv-neutral);
              opacity: 0;
              animation: 4.2s linear infinite mxv-modal-surface;
            }

            .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-close {
              display: grid;
              place-items: center;
              box-sizing: border-box;
              width: 4cqw;
              aspect-ratio: 1;
              position: absolute;
              z-index: 2;
              top: 2.3cqh;
              right: 1.8cqw;
              border: 0;
              background: transparent;
              box-shadow: none;
              color: var(--pv-primary);
              animation: 4.2s linear infinite mxv-modal-close-press;
            }

            .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-close::before,
            .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-close::after {
              content: "";
              width: 48%;
              height: 1px;
              position: absolute;
              left: 50%;
              top: 50%;
              translate: -50% -50%;
              background: currentColor;
            }

            .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-close::before {
              rotate: 45deg;
            }

            .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-close::after {
              rotate: -45deg;
            }

            .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-bento {
              display: grid;
              width: 100%;
              height: 100%;
              grid-template-columns: 1.2fr .8fr .8fr;
              grid-template-rows: 1fr 1fr;
              gap: 2.1cqw;
              opacity: 0;
              filter: blur(10px);
              translate: 0 4cqh;
              animation: 4.2s linear infinite mxv-modal-content;
            }

            .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-image {
              display: block !important;
              width: 100% !important;
              height: 100% !important;
              min-width: 0;
              min-height: 0;
            }

            .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-image--hero {
              grid-row: 1 / 3;
            }

            .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-image--wide {
              grid-column: 2 / 4;
            }

            @keyframes mxv-modal-path {
              0%, 25% {
                translate: var(--mxi-nav1-tip, 69.15cqw 5.47cqh);
                animation-timing-function: cubic-bezier(.16, 1, .3, 1);
              }
              34.52%, 43% {
                translate: var(--mxi-work1-tip, 33cqw 29.74cqh);
                animation-timing-function: cubic-bezier(.16, 1, .3, 1);
              }
              60%, 84% {
                translate: var(--mxv-modal-close-tip, 83.88cqw 17.95cqh);
                animation-timing-function: cubic-bezier(.16, 1, .3, 1);
              }
              94%, 100% {
                translate: var(--mxi-nav1-tip, 69.15cqw 5.47cqh);
              }
            }

            @keyframes mxv-modal-nav {
              0%, 5.95% {
                background-color: var(--pvs-bars);
                animation-timing-function: cubic-bezier(.16, 1, .3, 1);
              }
              8.81%, 25% { background-color: var(--pvs-cta); }
              27.86%, 100% { background-color: var(--pvs-bars); }
            }

            @keyframes mxv-drop-panel {
              0%, 5.94% { opacity: 0; scale: 1 0; }
              5.95% {
                opacity: 1;
                scale: 1 0;
                animation-timing-function: cubic-bezier(.16, 1, .3, 1);
              }
              10.24%, 25% { opacity: 1; scale: 1; }
              27.85% { opacity: 1; scale: 1 0; }
              27.86%, 100% { opacity: 0; scale: 1 0; }
            }
            @keyframes mxv-drop-rows {
              0%, 5.95% {
                opacity: 0;
                background-position: 0 -6px, 0 7px, 0 20px;
              }
              7.14% {
                opacity: .25;
                background-position: 0 -4.5px, 0 7px, 0 20px;
              }
              8.33% {
                opacity: .5;
                background-position: 0 -3px, 0 8.5px, 0 20px;
              }
              10.71% {
                opacity: 1;
                background-position: 0 0, 0 11.5px, 0 23px;
              }
              11.9% {
                opacity: 1;
                background-position: 0 0, 0 13px, 0 24.5px;
              }
              13.1%, 25% {
                opacity: 1;
                background-position: 0 0, 0 13px, 0 26px;
              }
              27.86%, 100% {
                opacity: 0;
                background-position: 0 -6px, 0 7px, 0 20px;
              }
            }

            @keyframes mxv-modal-click {
              0%, 39.99% { opacity: 0; scale: .35; }
              40% { opacity: .55; scale: .35; }
              43% { opacity: 0; scale: 1.5; }
              43.01%, 71.99% { opacity: 0; scale: .35; }
              72% { opacity: .55; scale: .35; }
              75% { opacity: 0; scale: 1.5; }
              75.01%, 100% { opacity: 0; scale: .35; }
            }

            @keyframes mxv-modal-backdrop {
              0%, 42.99% {
                opacity: 0;
                -webkit-backdrop-filter: blur(0);
                backdrop-filter: blur(0);
              }
              43% {
                opacity: 0;
                -webkit-backdrop-filter: blur(0);
                backdrop-filter: blur(0);
                animation-timing-function: cubic-bezier(.22, .72, .2, 1);
              }
              55%, 74.99% {
                opacity: 1;
                -webkit-backdrop-filter: blur(3px);
                backdrop-filter: blur(3px);
              }
              75% {
                opacity: 1;
                -webkit-backdrop-filter: blur(3px);
                backdrop-filter: blur(3px);
                animation-timing-function: cubic-bezier(.4, 0, 1, 1);
              }
              82%, 100% {
                opacity: 0;
                -webkit-backdrop-filter: blur(0);
                backdrop-filter: blur(0);
              }
            }

            @keyframes mxv-modal-surface {
              0%, 42.99% {
                opacity: 0;
                clip-path: inset(0 0 100% 0);
                filter: blur(7px);
                scale: 1;
              }
              43% {
                opacity: 0;
                clip-path: inset(0 0 100% 0);
                filter: blur(10px);
                scale: 1;
                animation-timing-function: cubic-bezier(.22, .72, .2, 1);
              }
              60%, 74.99% {
                opacity: 1;
                clip-path: inset(0);
                filter: blur(0);
                scale: 1;
              }
              75% {
                opacity: 1;
                clip-path: inset(0);
                filter: blur(0);
                scale: 1;
                animation-timing-function: cubic-bezier(.4, 0, 1, 1);
              }
              82% {
                opacity: 0;
                clip-path: inset(0 0 14% 0);
                filter: blur(4px);
                scale: 1;
              }
              82.01%, 100% {
                opacity: 0;
                clip-path: inset(0 0 100% 0);
                filter: blur(10px);
                scale: 1;
              }
            }

            @keyframes mxv-modal-content {
              0%, 46.99% {
                opacity: 0;
                filter: blur(10px);
                translate: 0 4cqh;
              }
              47% {
                opacity: 0;
                filter: blur(10px);
                translate: 0 4cqh;
                animation-timing-function: cubic-bezier(.16, 1, .3, 1);
              }
              61%, 74.99% {
                opacity: 1;
                filter: blur(0);
                translate: 0 0;
              }
              75% {
                opacity: 1;
                filter: blur(0);
                translate: 0 0;
                animation-timing-function: cubic-bezier(.4, 0, 1, 1);
              }
              81.5% {
                opacity: 0;
                filter: blur(4px);
                translate: 0 -1cqh;
              }
              81.51%, 100% {
                opacity: 0;
                filter: blur(10px);
                translate: 0 4cqh;
              }
            }

            @keyframes mxv-modal-close-press {
              0%, 52.99% {
                opacity: 0;
                filter: blur(4px);
                scale: 1;
              }
              53% {
                opacity: 0;
                filter: blur(4px);
                scale: 1;
                animation-timing-function: cubic-bezier(.16, 1, .3, 1);
              }
              60%, 71.99% {
                opacity: 1;
                filter: blur(0);
                scale: 1;
              }
              73.5% {
                opacity: 1;
                filter: blur(0);
                scale: .82;
              }
              75% {
                opacity: 1;
                filter: blur(0);
                scale: 1;
                animation-timing-function: cubic-bezier(.4, 0, 1, 1);
              }
              82% {
                opacity: 0;
                filter: blur(3px);
                scale: 1;
              }
              82.01%, 100% {
                opacity: 0;
                filter: blur(4px);
                scale: 1;
              }
            }

            @media (prefers-reduced-motion: reduce) {
              .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pv-nav-bars i:first-child::before,
              .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pv-nav-bars i:first-child::after {
                animation: none !important;
                opacity: 0 !important;
                scale: 1 0 !important;
              }

              .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .ps-cursor::after {
                animation: none !important;
                opacity: 0 !important;
                scale: 1 0 !important;
              }

              .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pv-nav-bars i:first-child,
              .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .ps-cursor {
                animation: none !important;
              }

              .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .pv-nav-bars i:first-child {
                background-color: var(--pvs-bars) !important;
              }

              .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .ps-cursor {
                translate: var(--mxi-nav1-tip, 69.15cqw 5.47cqh) !important;
              }

              .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-scene {
                display: none !important;
              }

              .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-backdrop,
              .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-surface,
              .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-bento,
              .picker-preview-motion[data-motion-cell="experience-responsive"] .pv-desktop .mxv-modal-close {
                animation: none !important;
              }
            }
          `;

          const board = doc.querySelector('.picker-preview-motion--index');
          const desktop = board?.querySelector('.pv-desktop');

          if (desktop && !desktop.querySelector('.mxv-modal-scene')) {
            desktop.insertAdjacentHTML(
              'beforeend',
              '<span class="mxv-modal-scene" aria-hidden="true">' +
                '<span class="mxv-modal-backdrop"></span>' +
                '<span class="mxv-modal-surface">' +
                  '<i class="mxv-modal-close"></i>' +
                  '<span class="mxv-modal-bento">' +
                    '<i class="pv-image mxv-modal-image mxv-modal-image--hero"></i>' +
                    '<i class="pv-image mxv-modal-image mxv-modal-image--wide"></i>' +
                    '<i class="pv-image mxv-modal-image"></i>' +
                    '<i class="pv-image mxv-modal-image"></i>' +
                  '</span>' +
                '</span>' +
              '</span>'
            );
          }

          if (!doc.getElementById(loopStyle.id)) doc.head.appendChild(loopStyle);
        }

        if (cell.slice(cell.indexOf('-') + 1) === 'choreographed') {
        /* Preview 31 opens with the same Motion OSS Hero stagger as preview 28,
           scrolls to a second gallery page, holds, and returns before replaying.
           Newly entering work unmasks and deblurs in artifact-first order while
           the fixed navigation preserves continuity. */
        const staggerStyle = doc.createElement('style');
        staggerStyle.id = 'choreographed-portfolio-stagger-only';
        staggerStyle.textContent = `
          .picker-preview-motion[data-motion-cell="experience-choreographed"],
          .picker-preview-motion[data-motion-cell="experience-choreographed"] *,
          .picker-preview-motion[data-motion-cell="experience-choreographed"] *::before,
          .picker-preview-motion[data-motion-cell="experience-choreographed"] *::after {
            animation: none !important;
            transition: none !important;
          }

          .picker-preview-motion[data-motion-cell="experience-choreographed"] .ps-cursor,
          .picker-preview-motion[data-motion-cell="experience-choreographed"] .ps-cursor::after {
            opacity: 0 !important;
          }

          .picker-preview-motion[data-motion-cell="experience-choreographed"] .pv-desktop .pg-row--scroll-one {
            margin-top: 12cqh;
          }

          .picker-preview-motion[data-motion-cell="experience-choreographed"] :is(
            .pv-desktop .pg-row:first-child > .pv-image,
            .pv-desktop .pg-row:first-child > .pg-cap,
            .pv-desktop .pg-row:nth-child(2) > .pv-image,
            .pv-desktop .pg-row:nth-child(2) > .pg-cap,
            .pg-phone-body > .pv-image:nth-child(1),
            .pg-phone-body > .pg-cap:nth-child(2),
            .pg-phone-body > .pv-image:nth-child(3),
            .pg-phone-body > .pg-cap:nth-child(4),
            .pv-tabbar
          ) {
            opacity: 1;
            filter: none;
            transform: none;
            clip-path: none !important;
            translate: none !important;
            scale: 1 !important;
          }

          @media (prefers-reduced-motion: reduce) {
            .picker-preview-motion[data-motion-cell="experience-choreographed"] :is(
              .pv-desktop .pg-row:first-child > .pv-image,
              .pv-desktop .pg-row:first-child > .pg-cap,
              .pv-desktop .pg-row:nth-child(2) > .pv-image,
              .pv-desktop .pg-row:nth-child(2) > .pg-cap,
              .pg-phone-body > .pv-image:nth-child(1),
              .pg-phone-body > .pg-cap:nth-child(2),
              .pg-phone-body > .pv-image:nth-child(3),
              .pg-phone-body > .pg-cap:nth-child(4),
              .pv-tabbar
            ) {
              opacity: 1 !important;
              filter: none !important;
              transform: none !important;
            }
          }
        `;
        if (!doc.getElementById(staggerStyle.id)) doc.head.appendChild(staggerStyle);

        const board = doc.querySelector('.picker-preview-motion--index');
        const desktopBody = board?.querySelector('.pv-desktop .pg-body');
        const phoneBody = board?.querySelector('.pv-phone .pg-phone-body');

        desktopBody
          ?.querySelectorAll(':scope > .pg-rail')
          .forEach((rail) => rail.remove());

        if (desktopBody && !desktopBody.querySelector('.pg-row--scroll-one')) {
          desktopBody.insertAdjacentHTML(
            'beforeend',
            '<span class="pg-row pg-row--more pg-row--scroll-one">' +
              '<span class="pv-image"></span>' +
              '<span class="pg-cap">' +
                '<i class="pg-cap-title" style="--w:31.4%"></i>' +
                '<i></i>' +
                '<i style="--w:61.8%"></i>' +
              '</span>' +
            '</span>' +
            '<span class="pg-row pg-row--flip pg-row--more pg-row--scroll-two">' +
              '<span class="pg-cap">' +
                '<i class="pg-cap-title" style="--w:38.2%"></i>' +
                '<i></i>' +
                '<i style="--w:59.4%"></i>' +
              '</span>' +
              '<span class="pv-image"></span>' +
            '</span>'
          );
        }

        if (phoneBody && !phoneBody.querySelector('.pg-phone-more-start')) {
          phoneBody.insertAdjacentHTML(
            'beforeend',
            '<span class="pv-image pg-phone-more pg-phone-more-start"></span>' +
            '<span class="pg-cap pg-phone-more pg-phone-more-copy-one">' +
              '<i class="pg-cap-title" style="--w:34.2%"></i>' +
              '<i style="--w:74.6%"></i>' +
              '<i style="--w:51.8%"></i>' +
            '</span>' +
            '<span class="pv-image pg-phone-more pg-phone-more-image-two"></span>' +
            '<span class="pg-cap pg-phone-more pg-phone-more-copy-two">' +
              '<i class="pg-cap-title" style="--w:28.8%"></i>' +
              '<i style="--w:82.4%"></i>' +
              '<i style="--w:58.2%"></i>' +
            '</span>'
          );
        }

        const groupSelectors = [
          [
            '.pv-desktop .pg-row:first-child > .pv-image',
            '.pv-desktop .pg-row:first-child > .pg-cap',
            '.pv-desktop .pg-row:nth-child(2) > .pv-image',
            '.pv-desktop .pg-row:nth-child(2) > .pg-cap'
          ],
          [
            '.pg-phone-body > .pv-image:nth-child(1)',
            '.pg-phone-body > .pg-cap:nth-child(2)',
            '.pg-phone-body > .pv-image:nth-child(3)',
            '.pg-phone-body > .pg-cap:nth-child(4)',
            '.pv-tabbar'
          ]
        ];

        const makePortfolioSpringFrames = () => {
          const stiffness = 120;
          const damping = 20;
          const mass = 1;
          const duration = 1050;
          const steps = 72;
          const naturalFrequency = Math.sqrt(stiffness / mass);
          const dampingRatio = damping / (2 * Math.sqrt(stiffness * mass));
          const dampedFrequency = naturalFrequency * Math.sqrt(1 - dampingRatio ** 2);

          return Array.from({ length: steps + 1 }, (_, index) => {
            const offset = index / steps;
            const seconds = (duration * offset) / 1000;
            const displacement = index === steps ? 0 :
              Math.exp(-dampingRatio * naturalFrequency * seconds) *
              (
                Math.cos(dampedFrequency * seconds) +
                (dampingRatio * naturalFrequency / dampedFrequency) *
                Math.sin(dampedFrequency * seconds)
              );
            const progress = Math.max(0, Math.min(1, 1 - displacement));

            return {
              offset,
              opacity: Number(progress.toFixed(4)),
              filter: `blur(${(4 * (1 - progress)).toFixed(3)}px)`,
              transform: `translateY(${(40 * displacement).toFixed(3)}px)`
            };
          });
        };

        const scrollRevealFrames = {
          imageFromLeft: [
            {
              opacity: 0.12,
              filter: 'blur(9px)',
              clipPath: 'inset(0 100% 0 0)',
              transform: 'translateX(-72px) scale(1.025)'
            },
            {
              opacity: 1,
              filter: 'blur(0px)',
              clipPath: 'inset(0)',
              transform: 'translateX(0px) scale(1)'
            }
          ],
          copyFromRight: [
            {
              opacity: 0,
              filter: 'blur(5px)',
              clipPath: 'inset(0 0 0 100%)',
              transform: 'translateX(44px)'
            },
            {
              opacity: 1,
              filter: 'blur(0px)',
              clipPath: 'inset(0)',
              transform: 'translateX(0px)'
            }
          ],
          imageFromRight: [
            {
              opacity: 0.12,
              filter: 'blur(9px)',
              clipPath: 'inset(0 0 0 100%)',
              transform: 'translateX(72px) scale(1.025)'
            },
            {
              opacity: 1,
              filter: 'blur(0px)',
              clipPath: 'inset(0)',
              transform: 'translateX(0px) scale(1)'
            }
          ],
          copyFromLeft: [
            {
              opacity: 0,
              filter: 'blur(5px)',
              clipPath: 'inset(0 100% 0 0)',
              transform: 'translateX(-44px)'
            },
            {
              opacity: 1,
              filter: 'blur(0px)',
              clipPath: 'inset(0)',
              transform: 'translateX(0px)'
            }
          ]
        };

        const motionPreference = win.matchMedia('(prefers-reduced-motion: reduce)');

        if (
          board &&
          win.Element?.prototype.animate &&
          !motionPreference.matches
        ) {
          const sequenceAnimations = [];
          const springFrames = makePortfolioSpringFrames();
          for (const selectors of groupSelectors) {
            selectors
              .map((selector) => board.querySelector(selector))
              .filter(Boolean)
              .forEach((element, index) => {
                sequenceAnimations.push(
                  element.animate(springFrames, {
                    duration: 1050,
                    delay: index * 100,
                    easing: 'linear',
                    fill: 'both'
                  })
                );
              });
          }

          const sequenceDuration = 7200;
          const scrollDownStart = 1750;
          const scrollDownEnd = 2850;
          const scrollUpStart = 5400;
          const scrollUpEnd = 6500;
          const sequenceOffset = (milliseconds) =>
            milliseconds / sequenceDuration;

          const animateScrollPage = (track, firstItem, nextItem) => {
            if (!track || !firstItem || !nextItem) return;
            const distance = nextItem.offsetTop - firstItem.offsetTop;
            if (!(distance > 0)) return;
            sequenceAnimations.push(
              track.animate(
                [
                  { offset: 0, transform: 'translateY(0px)' },
                  {
                    offset: sequenceOffset(scrollDownStart),
                    transform: 'translateY(0px)',
                    easing: 'cubic-bezier(.65, 0, .35, 1)'
                  },
                  {
                    offset: sequenceOffset(scrollDownEnd),
                    transform: `translateY(${-distance}px)`
                  },
                  {
                    offset: sequenceOffset(scrollUpStart),
                    transform: `translateY(${-distance}px)`,
                    easing: 'cubic-bezier(.65, 0, .35, 1)'
                  },
                  {
                    offset: sequenceOffset(scrollUpEnd),
                    transform: 'translateY(0px)'
                  },
                  { offset: 1, transform: 'translateY(0px)' }
                ],
                {
                  duration: sequenceDuration,
                  easing: 'linear',
                  fill: 'both'
                }
              )
            );
          };

          animateScrollPage(
            desktopBody,
            desktopBody?.querySelector(':scope > .pg-row:first-child'),
            desktopBody?.querySelector(':scope > .pg-row--scroll-one')
          );
          animateScrollPage(
            phoneBody,
            phoneBody?.querySelector(':scope > .pv-image:first-child'),
            phoneBody?.querySelector(':scope > .pg-phone-more-start')
          );

          const scrollReveals = [
            ['.pv-desktop .pg-row--scroll-one > .pv-image', 'imageFromLeft', 2020],
            ['.pv-desktop .pg-row--scroll-one > .pg-cap', 'copyFromRight', 2160],
            ['.pv-desktop .pg-row--scroll-two > .pv-image', 'imageFromRight', 2400],
            ['.pv-desktop .pg-row--scroll-two > .pg-cap', 'copyFromLeft', 2540],
            ['.pv-phone .pg-phone-more-start', 'imageFromLeft', 2020],
            ['.pv-phone .pg-phone-more-copy-one', 'copyFromRight', 2160],
            ['.pv-phone .pg-phone-more-image-two', 'imageFromRight', 2400],
            ['.pv-phone .pg-phone-more-copy-two', 'copyFromLeft', 2540]
          ];

          for (const [selector, kind, delay] of scrollReveals) {
            const element = board.querySelector(selector);
            if (!element) continue;
            sequenceAnimations.push(
              element.animate(scrollRevealFrames[kind], {
                duration: kind.startsWith('image') ? 720 : 620,
                delay,
                easing: 'cubic-bezier(.16, 1, .3, 1)',
                fill: 'both'
              })
            );
          }

          const restartSequence = () => {
            if (motionPreference.matches) {
              sequenceAnimations.forEach((animation) => animation.cancel());
              return;
            }
            sequenceAnimations.forEach((animation) => {
              animation.pause();
              animation.currentTime = 0;
              animation.play();
            });
          };

          motionBoard.__replayMotion = restartSequence;

          motionPreference.addEventListener('change', ({ matches }) => {
            if (matches) {
              sequenceAnimations.forEach((animation) => animation.cancel());
            } else {
              restartSequence();
            }
          });

          win.addEventListener('pagehide', () => {
            sequenceAnimations.forEach((animation) => animation.cancel());
          });
        }
        }

        /* Plot tip-compensated cursor stops. Previews 29 and 30 aim the actual
           SVG apex at M1 1; the older index motions retain their existing
           empirical hotspot. Aim the visible point at each target center,
           not the cursor box itself. */
        const plotIndexTips = () => {
          for (const board of doc.querySelectorAll('.picker-preview-motion--index')) {
            const desk = board.querySelector('.pv-desktop');
            const cursor = board.querySelector('.ps-cursor');
            if (!desk?.clientWidth || !desk.clientHeight || !cursor) continue;
            const deskRect = desk.getBoundingClientRect();
            const deskStyle = win.getComputedStyle(desk);
            const borderLeft = parseFloat(deskStyle.borderLeftWidth) || 0;
            const borderRight = parseFloat(deskStyle.borderRightWidth) || 0;
            const borderTop = parseFloat(deskStyle.borderTopWidth) || 0;
            const borderBottom = parseFloat(deskStyle.borderBottomWidth) || 0;
            const contentWidth = deskRect.width - borderLeft - borderRight;
            const contentHeight = deskRect.height - borderTop - borderBottom;
            const cursorStyle = win.getComputedStyle(cursor);
            const cursorWidth = parseFloat(cursorStyle.width) || cursor.offsetWidth;
            const cursorHeight = parseFloat(cursorStyle.height) || cursor.offsetHeight;
            const cursorScale = Math.min(cursorWidth / 14, cursorHeight / 20);
            const usesTrueApex = ['restrained', 'responsive']
              .includes(cell.slice(cell.indexOf('-') + 1));
            const hotspotX = cursorScale * (usesTrueApex ? 1 : 2.2);
            const hotspotY = cursorScale * (usesTrueApex ? 1 : 3.9);
            const put = (name, selector) => {
              const el = desk.querySelector(selector);
              if (!el) return;
              const r = el.getBoundingClientRect();
              const x = ((r.left + r.width / 2 - deskRect.left - borderLeft - hotspotX) / contentWidth) * 100;
              const y = ((r.top + r.height / 2 - deskRect.top - borderTop - hotspotY) / contentHeight) * 100;
              board.style.setProperty(name, x.toFixed(2) + 'cqw ' + y.toFixed(2) + 'cqh');
            };
            put('--mxi-nav1-tip', '.pv-nav-bars i:nth-child(1)');
            put('--mxi-work1-tip', '.pg-row:nth-of-type(1) > .pv-image');
            put('--mxi-work2-tip', '.pg-row:nth-of-type(2) > .pv-image');
            put('--mxi-rail-tip', '.pg-arrow--next');
            put('--mxr-modal-close-tip', '.mxr-modal-close');
            put('--mxv-modal-close-tip', '.mxv-modal-close');
          }
        };

        win.requestAnimationFrame(() => {
          plotIndexTips();
          win.requestAnimationFrame(plotIndexTips);
        });

        const desk = doc.querySelector('.pv-desktop');
        if (desk && win.ResizeObserver) {
          const observer = new win.ResizeObserver(plotIndexTips);
          observer.observe(desk);
          motionBoard.__portfolioTipObserver = observer;
        }
      }

    if (cell === 'persuade-restrained') installPerfectCursorLoop();
    if (cell === 'persuade-responsive') installResponsiveLandingCorrections();
    if (cell === 'persuade-choreographed') installChoreographedPremium();
    if (cell.startsWith('persuade-')) installEmailCapture();
    if (cell.startsWith('experience-')) installPortfolioFixes();
  }
}
installPremiumMotion();


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

/* The contrast alert: a danger badge on the neutral swatch, with its
   explanation in the sibling tooltip. Both strips carry one. This strip's
   badge is re-read from renderPreview() on every render, so every path
   that can change which color sits in the neutral slot (inputs, tints,
   rings, card switch, reset, reorder) lands here; the strategy strip's
   badge is re-read by paintStrategyBands() against the committed fields
   that strip is painted from. One block-level line per failed check,
   mid-tone first. */
const alertBadge = $('[data-contrast-alert]', panel);
const alertTip = $('[data-contrast-tip]', panel);

function paintContrastAlert(badge, tip, issues) {
  badge.hidden = issues.length === 0;
  tip.replaceChildren(...issues.map((text) => {
    const line = document.createElement('span');
    line.textContent = text;
    return line;
  }));
}

function syncNeutralAlert() {
  paintContrastAlert(alertBadge, alertTip, cards.length ? neutralContrastIssue(state().colors) : []);
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
   screen: both end in the fields this paints from. Its neutral carries the
   same contrast alert the editable strip does, judged against the same
   committed colors this strip is painted from, so a reorder made here that
   drags a mid-tone into the neutral slot is reported here, on the swatch
   the visitor just dropped. */
const strategyAlertBadge = $('[data-contrast-alert]', strategyBands);
const strategyAlertTip = $('[data-contrast-tip]', strategyBands);

function paintStrategyBands() {
  const committed = roleMap((role) => $(`[name="palette-${role}"]`).value);
  if (Object.values(committed).some((hex) => !hex)) return;
  for (const role of ROLES) {
    const band = $(`[data-band="${role}"]`, strategyBands);
    band.style.setProperty('--band-color', committed[role]);
    band.style.setProperty('--band-ink', contrastInk(committed[role]));
    $('output', band).textContent = committed[role];
  }
  paintContrastAlert(strategyAlertBadge, strategyAlertTip, neutralContrastIssue(committed));
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
  // The hub re-reads every answer on arrival, so an edit made on a
  // question screen is on its card by the time the return lands.
  if (event.detail.screen === '04b') renderHub();
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
    for (const node of frame.querySelectorAll('[data-surface]:not([data-artboard])')) node.remove();
    for (const input of chosen) {
      if (frame.querySelector(`[data-artboard][data-surface="${input.value}"]`)) continue;
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

/* ============================================================
   Screen 04b: the configure hub.

   Five questions remain after the layout screen, and every one of
   them already holds an answer: sync() pre-fills each per-surface
   field with its surface's default the moment the tile is checked,
   and the flat radios ship with a default checked. The hub reads
   those answers back out of the DOM (hidden fields for per-surface
   questions, the checked radio for flat ones), maps each value to
   the title on its own option row, and marks the cards whose
   answer a person actually picked. Nothing here writes an answer;
   the cards are a reading of the form.
   ============================================================ */
const hubScreen = document.querySelector('.picker-screen[data-screen="04b"]');
/* Card target screen mapped to the radio group that screen answers. */
const HUB_GROUPS = {
  '06': 'motion-energy',
  '08': 'boundary-style',
  '09': 'corner-style',
  '10': 'depth-style',
  '11': 'icon-pack',
};
/* The icon set renders no per-surface fields, so it has no
   dataset.chosen. A change event on its group is the one signal
   that a person picked rather than the markup default: programmatic
   checks never fire it. */
const hubEdited = new Set();
document.addEventListener('change', ({ target }) => {
  if (target?.name === 'icon-pack') hubEdited.add(target.name);
});

const hubSurfaceLabel = (mode) => modeInputs.find((input) => input.value === mode)?.dataset.surfaceLabel ?? mode;

/* The display title lives on the option row of the question's own
   screen, so the hub never restates copy. The two dealt-data groups
   carry their names as data attributes instead of a row label. */
function hubOptionTitle(group, value) {
  const input = document.querySelector(`input[name="${group}"][value="${value}"]`);
  if (!input) return value;
  if (input.dataset.scaleName) return `${input.dataset.scaleName} · ${input.dataset.ratio}`;
  if (input.dataset.packName) return input.dataset.packName;
  return input.closest('.picker-strategy-option')?.querySelector('.picker-strategy-title')?.textContent.trim() ?? value;
}

/* The enabled fields are exactly the chosen surfaces this question
   was put to; sync() disables the rest and empties their values. */
function hubSurfaceRows(group) {
  return [...document.querySelectorAll(`input[type="hidden"][data-surface-field^="${group}-"]`)]
    .filter((field) => !field.disabled && field.value)
    .map((field) => ({
      mode: field.dataset.surfaceField.slice(group.length + 1),
      value: field.value,
      chosen: field.dataset.chosen === 'yes',
    }));
}

/* A summary row is a surface pill on the left and the value docked
   right behind a patina dot, the same signal the surface tabs and the
   option rows spend on a committed choice. The plain line survives
   only for the skipped-card message. */
function hubPlainLine(text) {
  const line = document.createElement('span');
  line.className = 'picker-hub-line';
  line.append(text);
  return line;
}

function hubRow(surfaceLabel, valueTitle, group, value) {
  const entry = document.createElement('span');
  entry.className = 'picker-hub-entry';
  const pill = document.createElement('span');
  pill.className = 'picker-hub-pill';
  const label = document.createElement('span');
  label.className = 'picker-hub-pill-label';
  label.textContent = surfaceLabel;
  const val = document.createElement('span');
  val.className = 'picker-hub-value';
  const dot = document.createElement('i');
  dot.className = 'picker-hub-dot';
  dot.setAttribute('aria-hidden', 'true');
  val.append(dot, valueTitle);
  pill.append(label, val);
  entry.append(pill);
  if (group !== 'icon-pack') {
    const note = document.createElement('span');
    note.className = 'picker-hub-note';
    const why = value ? hubOptionDesc(group, value) : '';
    note.textContent = why;
    note.hidden = !why;
    entry.append(note);
  }
  return entry;
}

/* The one-line reason the current answer is a sound default, read off
   the option row's own description so the hub never restates copy.
   dataset.copy is read first because applyAllows swaps textContent for
   a blocked reason on surfaces that rule the option out. */
function hubOptionDesc(group, value) {
  const input = document.querySelector(`input[name="${group}"][value="${value}"]`);
  const desc = input?.closest('.picker-strategy-option')?.querySelector('.picker-strategy-desc');
  if (!desc) return '';
  return (desc.dataset.copy ?? desc.textContent).trim();
}

/* ============================================================
   Hub previews: each card's body is a clone of its question's own
   artboard, painted with the committed palette and the previewed
   surface's answers.

   The material clones borrow design-context.css's proof frame: the
   committed bodies there key off data-dcx-* attributes on the frame
   because a clone cannot ride the #picker-form:has() selectors its
   original took its rendition from once the answer has to differ per
   card. The stylesheet is already on this page, so nothing is
   restated. The motion clone is the one exception: its scenes exist
   only as #picker-form:has() rules with no dcx mirror, so it keeps
   its scene classes, stays keyed to the live motion-energy radio,
   and the renderer parks that radio on the previewed surface's
   answer the same way the question screens park it. The keyframes
   are infinite, so the clone loops on its own; the hover-restart
   wiring never reaches it (replayMotion holds the boards it listed
   at load, and screen 06's hover rows are display: none here).
   ============================================================ */
const HUB_PREVIEW_MARK_GROUPS = {
  strategy: 'color-strategy',
  boundary: 'boundary-style',
  corner: 'corner-style',
  depth: 'depth-style',
  layout: 'layout-structure',
};

/* One surface's committed structural answers, read off the same hidden
   fields the summary rows read; the checked radio covers a flat group
   whose field this surface never rendered. */
function hubPreviewMarks(mode) {
  const marks = { surface: mode };
  for (const [mark, group] of Object.entries(HUB_PREVIEW_MARK_GROUPS)) {
    marks[mark] = document.querySelector(`input[type="hidden"][data-surface-field="${group}-${mode}"]`)?.value
      || document.querySelector(`input[name="${group}"]:checked`)?.value || '';
  }
  return marks;
}

/* Clone one question's mounted artboard into a proof frame, the same
   lift design-context.js's proofHtml performs: ids do not survive (they
   would collide with the originals), the surface attribute moves to the
   frame, and the committed palette is painted on the frame under the
   --pkc-* names the dcx bodies read. */
function hubProof(source, marks = null) {
  const wrap = document.createElement('span');
  wrap.className = 'picker-hub-proof';
  if (marks) {
    wrap.classList.add('dcx-proof--board');
    for (const [key, value] of Object.entries(marks)) {
      if (value) wrap.setAttribute(`data-dcx-${key}`, value);
    }
    syncCommittedPalette(wrap, 'pkc');
  }
  const clone = source.cloneNode(true);
  clone.hidden = false;
  clone.removeAttribute('data-surface');
  for (const node of [clone, ...clone.querySelectorAll('[id]')]) node.removeAttribute('id');
  /* The icon sheet's lookup hooks must not survive either: the hub card
     sits before screen 11 in the DOM, so a clone still carrying them
     would shadow the originals for every later querySelector, including
     the document's own icon proof. */
  for (const node of [clone, ...clone.querySelectorAll('[data-icon-field], [data-icon-strip]')]) {
    node.removeAttribute('data-icon-sheet');
    node.removeAttribute('data-icon-field');
    node.removeAttribute('data-icon-strip');
  }
  wrap.append(clone);
  return wrap;
}

const hubQuestionBoard = (screen, mode) => {
  const boards = [...document.querySelectorAll(
    `.picker-screen[data-screen="${screen}"] .picker-board-stage > :is(.picker-artboard, .picker-preview)[data-surface="${mode}"]`,
  )];
  if (boards.length < 2) return boards[0] ?? null;
  /* The motion screen boards one drawing per surface and option and shows the
     one the answer names. Taking the first would hand the card a board the
     option rules keep hidden, which is a card with an empty frame in it. */
  const group = document.querySelector(`.picker-screen[data-screen="${screen}"] [data-surface-tabs]`)?.dataset.surfaceTabs;
  const answer = group && document.querySelector(`input[type="hidden"][data-surface-field="${group}-${mode}"]`)?.value;
  return boards.find((board) => board.dataset.motionCell === `${mode}-${answer}`) ?? boards[0];
};

/* The preview and its tab strip for one card. The active tab carries
   the patina dot and the surface's answer, so the choice reads without
   hovering; the tooltip carries the summary rows. */
function renderHubPreview(cardNode, rows) {
  const previewSlot = cardNode.querySelector('[data-hub-preview]');
  const tabsSlot = cardNode.querySelector('[data-hub-tabs]');
  const screen = cardNode.dataset.hubTarget;
  const group = HUB_GROUPS[screen];
  if (group === 'icon-pack') {
    tabsSlot.hidden = true;
    tabsSlot.replaceChildren();
    previewSlot.replaceChildren(hubProof(iconSheet));
    /* The glyphs are fetched on screen 11's first arrival, which a run
       that stops at the hub never makes; fetch them here and re-render
       once. The empty marker is the failed state, which must not refetch
       on every arrival. */
    if (!iconField.querySelector('.picker-icon-cell') && !('empty' in iconField.dataset)) {
      loadIconPacks().then(renderHub);
    }
    return;
  }
  const modes = rows.map((row) => row.mode);
  const mode = modes.includes(cardNode.dataset.hubSurface) ? cardNode.dataset.hubSurface : modes[0];
  cardNode.dataset.hubSurface = mode ?? '';
  const board = mode ? hubQuestionBoard(screen, mode) : null;
  if (!board) {
    previewSlot.replaceChildren();
    tabsSlot.hidden = true;
    tabsSlot.replaceChildren();
    return;
  }
  if (group === 'motion-energy') {
    surfaceQuestions.find((question) => question.screen === screen)?.park(mode);
    const proof = hubProof(board);
    syncCommittedPalette(proof.firstChild);
    previewSlot.replaceChildren(proof);
    /* The route stops are measured off the clone's own layout, exactly
       what screen 06 does for the originals on arrival. */
    requestAnimationFrame(() => plotMotionRoute(proof.firstChild));
  } else {
    previewSlot.replaceChildren(hubProof(board, hubPreviewMarks(mode)));
  }
  tabsSlot.hidden = rows.length === 0;
  tabsSlot.replaceChildren(...rows.map((row) => {
    const tab = document.createElement('span');
    tab.className = 'picker-hub-tab';
    tab.dataset.hubTab = row.mode;
    const dot = document.createElement('i');
    dot.className = 'picker-hub-tab-dot';
    dot.setAttribute('aria-hidden', 'true');
    tab.append(dot, hubSurfaceLabel(row.mode));
    if (row.mode === mode) {
      tab.dataset.on = '';
      const value = document.createElement('span');
      value.className = 'picker-hub-tab-value';
      value.textContent = hubOptionTitle(group, row.value);
      tab.append(value);
    }
    return tab;
  }));
}

function renderHubCard(cardNode) {
  const group = HUB_GROUPS[cardNode.dataset.hubTarget];
  if (!group) return;
  const summary = cardNode.querySelector('[data-hub-summary]');
  const mark = cardNode.querySelector('[data-hub-mark]');
  const previewSlot = cardNode.querySelector('[data-hub-preview]');
  const tabsSlot = cardNode.querySelector('[data-hub-tabs]');
  const target = document.querySelector(`.picker-screen[data-screen="${cardNode.dataset.hubTarget}"]`);
  const skipped = Boolean(target?.hasAttribute('data-skip'));
  cardNode.classList.toggle('is-skipped', skipped);
  cardNode.disabled = skipped;
  cardNode.setAttribute('aria-disabled', skipped ? 'true' : 'false');
  if (skipped) {
    summary.replaceChildren();
    previewSlot.replaceChildren(hubPlainLine('Not asked of these surfaces'));
    tabsSlot.hidden = true;
    tabsSlot.replaceChildren();
    cardNode.classList.remove('is-edited');
    mark.hidden = true;
    return;
  }
  const rows = hubSurfaceRows(group);
  let edited;
  let lines;
  if (rows.length === 0) {
    const checked = document.querySelector(`input[name="${group}"]:checked`);
    edited = hubEdited.has(group);
    lines = [hubRow(
      'All surfaces',
      checked ? hubOptionTitle(group, checked.value) : '',
      group,
      checked?.value,
    )];
  } else {
    edited = rows.some((row) => row.chosen);
    if (rows.length > 1 && rows.every((row) => row.value === rows[0].value)) {
      lines = [hubRow('All surfaces', hubOptionTitle(group, rows[0].value), group, rows[0].value)];
    } else if (rows.length === 1) {
      lines = [hubRow(hubSurfaceLabel(rows[0].mode), hubOptionTitle(group, rows[0].value), group, rows[0].value)];
    } else {
      lines = rows.map((row) => hubRow(
        hubSurfaceLabel(row.mode),
        hubOptionTitle(group, row.value),
        group,
        row.value,
      ));
    }
  }
  summary.replaceChildren(...lines);
  cardNode.classList.toggle('is-edited', edited);
  mark.hidden = !edited;
  renderHubPreview(cardNode, rows);
}

function renderHub() {
  if (!hubScreen) return;
  for (const cardNode of hubScreen.querySelectorAll('.picker-hub-card')) renderHubCard(cardNode);
}

/* The tooltip floats above the card and flips below when the card sits
   too near the viewport top to hold it; when neither side holds the
   whole panel, the roomier side takes it. Measured when the pointer or
   focus arrives, before the reveal transition starts; the tip is
   opacity-hidden rather than display-hidden, so its height is real. */
function placeHubTip(cardNode) {
  const tip = cardNode.querySelector('[data-hub-tip]');
  if (!tip) return;
  const rect = cardNode.getBoundingClientRect();
  const need = tip.offsetHeight + 20;
  const above = rect.top;
  const below = window.innerHeight - rect.bottom;
  cardNode.dataset.tipAt = (above >= need || above >= below) ? 'above' : 'below';
}
hubScreen?.addEventListener('pointerover', (event) => {
  const cardNode = event.target.closest('.picker-hub-card');
  if (cardNode) placeHubTip(cardNode);
});
hubScreen?.addEventListener('focusin', (event) => {
  const cardNode = event.target.closest('.picker-hub-card');
  if (cardNode) placeHubTip(cardNode);
});

/* Cards and the finish CTA jump by screen id. The inline nav script
   owns goTo(); it listens for this event, so no swap logic is
   duplicated here. A disabled card never reaches this handler. A mini
   tab hit re-clones its own card instead and never travels: the card
   click must stay the jump to the question. */
hubScreen?.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-hub-tab]');
  if (tab) {
    event.stopPropagation();
    const cardNode = tab.closest('.picker-hub-card');
    cardNode.dataset.hubSurface = tab.dataset.hubTab;
    renderHubCard(cardNode);
    return;
  }
  const cardNode = event.target.closest('[data-hub-target]');
  if (!cardNode || cardNode.disabled) return;
  document.dispatchEvent(new CustomEvent('picker:goto', {
    detail: { screen: cardNode.dataset.hubTarget },
  }));
});

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
