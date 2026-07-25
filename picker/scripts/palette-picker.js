import { contrastInk, formatOklch, hexToOklch, oklchToHex, seedToRoles } from './color.js';

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
const strategyPreview = document.querySelector('[data-strategy-preview]');
const typePreview = document.querySelector('[data-type-preview]');
const fontOptions = document.querySelector('[data-font-options]');
const pairTemplate = document.querySelector('[data-pair-card]');
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
  lines: ['Ut enim ad minim veniam, quis nostrud exercitation', 'ullamco laboris nisi ut aliquip ex ea commodo.'],
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
  target.style.setProperty('--pv-n-ink', contrastInk(committed.neutral));
  target.style.setProperty('--pv-p-ink', contrastInk(committed.primary));
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
  typePreview.style.setProperty('--pt-heading', fontStack(pair.heading.family));
  typePreview.style.setProperty('--pt-body', fontStack(pair.body.family));
  typePreview.style.setProperty('--pt-heading-weight', pair.heading.weight);
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
  fillIndexed(desktop, '[data-type-section-body]', LOREM.lines);
  fillIndexed(phoneBody, '[data-type-section-body]', LOREM.lines);
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

function addPairCard(pair, { checked = false, prepend = false } = {}) {
  const node = pairTemplate.content.firstElementChild.cloneNode(true);
  const input = node.querySelector('input');
  input.value = pair.id;
  input.checked = checked;
  input.setAttribute('aria-label', `${pair.heading.family} with ${pair.body.family}`);
  node.style.setProperty('--pair-heading', fontStack(pair.heading.family));
  node.style.setProperty('--pair-body', fontStack(pair.body.family));
  node.style.setProperty('--pair-heading-weight', pair.heading.weight);
  node.style.setProperty('--pair-body-weight', pair.body.weight);
  node.querySelector('[data-pair-heading]').textContent = pair.heading.family;
  node.querySelector('[data-pair-body]').textContent = pair.body.family;
  node.querySelector('[data-pair-why]').textContent = pair.why;
  if (prepend) fontOptions.prepend(node);
  else fontOptions.append(node);
  return node;
}

function renderFontPairs(manifest, fallback) {
  fontManifest = normalizeFontManifest(manifest);
  fontOptions.toggleAttribute('data-fallback', fallback);
  manifest.pairs.forEach((pair, index) => addPairCard(pair, { checked: index === 0 }));
  loadFontStylesheet(manifest.pairs);
  syncFontPair(manifest.pairs[0]);
}

fontOptions.onchange = ({ target }) => {
  if (!target.matches('input[name="font-pair"]')) return;
  const pair = fontManifest.pairs.find(({ id }) => id === target.value);
  if (pair) syncFontPair(pair);
};

// Scroll by whole cards so a row never ends up half in frame.
const scrollButtons = [...document.querySelectorAll('[data-font-scroll]')];
for (const button of scrollButtons) {
  button.onclick = () => {
    const step = fontOptions.querySelector('.picker-type-option')?.offsetHeight || 100;
    fontOptions.scrollBy({ top: step * Number(button.dataset.fontScroll), behavior: 'smooth' });
  };
}

function syncScrollButtons() {
  const room = fontOptions.scrollHeight - fontOptions.clientHeight;
  for (const button of scrollButtons) {
    const down = button.dataset.fontScroll === '1';
    const spent = down ? fontOptions.scrollTop >= room - 1 : fontOptions.scrollTop <= 1;
    button.disabled = room < 2 || spent;
  }
}

fontOptions.addEventListener('scroll', syncScrollButtons, { passive: true });
new ResizeObserver(syncScrollButtons).observe(fontOptions);

/* Custom fonts. A URL is carried through as-is; an uploaded face is handed to
   the server, which stores the bytes and returns the path the answers record.
   Neither is parsed here: the questionnaire validates at the end. */
const fontModal = document.querySelector('[data-font-modal]');
const customStatus = fontModal.querySelector('[data-custom-status]');
const customFile = (role) => fontModal.querySelector(`[data-custom-file="${role}"]`);
const customUrl = (role) => fontModal.querySelector(`[data-custom-url="${role}"]`);
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
      customStatus.textContent = '';
    };
    item.append(name, remove);
    list.append(item);
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
    renderCustomFileList(role);
  }
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
  };
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

document.querySelector('[data-font-custom-save]').onclick = async () => {
  customStatus.textContent = 'Saving…';
  let heading;
  let body;
  try {
    [heading, body] = await Promise.all([resolveCustomFace('heading'), resolveCustomFace('body')]);
  } catch (error) {
    customStatus.textContent = error.message;
    return;
  }
  if (!heading && !body) {
    customStatus.textContent = 'Add a URL or a file for at least one role.';
    return;
  }
  const current = fontManifest.pairs.find(({ id }) => id === fontOptions.querySelector('input:checked')?.value);
  const pair = {
    id: 'custom',
    name: 'Custom',
    heading: heading || current.heading,
    body: body || current.body,
    why: 'Your own faces',
  };
  fontManifest.pairs = [pair, ...fontManifest.pairs.filter(({ id }) => id !== 'custom')];
  addPairCard(pair, { prepend: true });
  loadCustomFace(pair);
  fontOptions.querySelector('input[value="custom"]').checked = true;
  syncFontPair(pair);
  fontOptions.scrollTo({ top: 0 });
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
  const target = { '03': strategyPreview, '04': typePreview }[event.detail.screen];
  if (target) syncCommittedPalette(target);
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
