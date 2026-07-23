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
const states = new Map();
const canvases = new WeakMap();
let cards = [];
let current = 0;
let openTint;

const roleMap = (value) => Object.fromEntries(ROLES.map((role) => [role, value(role)]));
const card = () => cards[current];
const state = () => states.get(card().id);
const dismissRingGuide = () => ringGuide.setAttribute('aria-hidden', 'true');

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
  const [currentL, C, H] = hexToOklch(state().colors[role]);
  const nearest = Math.max(0, Math.min(6, Math.round((0.92 - currentL) / (0.74 / 6))));
  $$('[data-tint]', strip).forEach((button, index) => {
    const L = 0.92 - index * (0.74 / 6);
    const hex = oklchToHex([L, C * (0.55 + 0.45 * Math.sin(Math.PI * index / 6)), H]);
    button.dataset.tint = hex;
    button.style.setProperty('--tint-color', hex);
    button.setAttribute('aria-label', hex);
    button.toggleAttribute('data-current', index === nearest);
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
document.addEventListener('picker:screenchange', (event) => activate(event.detail.screen === '02'));

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
