#!/usr/bin/env node
/**
 * Vendor one fixed specimen from each open-source icon pack the picker offers.
 *
 *   node scripts/vendor-icons.mjs           # rebuild from the pinned versions
 *   node scripts/vendor-icons.mjs --latest  # re-resolve each pack's latest first
 *   node scripts/vendor-icons.mjs --dry-run # resolve and report, write nothing
 *
 * Every pack draws the same 24 concepts, so the specimen grid compares packs
 * rather than vocabularies. Output is picker/data/icon-packs.json: pack
 * metadata plus sanitized inner SVG markup, small enough to ship with the
 * picker and offline once it is there.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'picker/data/icon-packs.json');
const dryRun = process.argv.includes('--dry-run');
const useLatest = process.argv.includes('--latest');

/** The specimen. Order is the reading order of the grid. */
const CONCEPTS = [
  'home', 'search', 'user', 'settings', 'bell', 'heart',
  'star', 'calendar', 'mail', 'message', 'trash', 'download',
  'upload', 'plus', 'check', 'close', 'chevron-right', 'arrow-right',
  'menu', 'filter', 'edit', 'lock', 'eye', 'external-link',
];

/**
 * Candidate names per concept, best glyph first. Packs disagree on almost
 * every noun here, so the resolver walks the list against each pack's real
 * file listing and takes the first hit. Anything this misses gets an explicit
 * entry in the pack's `overrides`.
 */
const ALIASES = {
  home: ['home', 'house'],
  search: ['search', 'magnifying-glass'],
  user: ['user', 'person', 'account'],
  settings: ['settings', 'gear', 'gear-six', 'cog'],
  bell: ['bell', 'notification'],
  heart: ['heart', 'favourite'],
  star: ['star'],
  calendar: ['calendar', 'calendar-blank', 'calendar-days', 'calendar3'],
  mail: ['mail', 'envelope', 'envelope-closed', 'email'],
  message: [
    'message-circle', 'chat-circle', 'chat-bubble-left', 'comment',
    'chat-bubble', 'message-square', 'chat-dots', 'message', 'chat',
  ],
  trash: ['trash-2', 'trash', 'trash-can', 'delete-bin'],
  download: ['download', 'download-simple', 'arrow-down-tray'],
  upload: ['upload', 'upload-simple', 'arrow-up-tray'],
  plus: ['plus', 'add'],
  check: ['check', 'checkmark', 'tick'],
  close: ['x', 'x-mark', 'cross-1', 'xmark', 'close'],
  'chevron-right': ['chevron-right', 'caret-right', 'nav-arrow-right', 'arrow-right-s'],
  'arrow-right': ['arrow-right'],
  menu: ['menu', 'bars-3', 'hamburger-menu', 'three-bars', 'list', 'menu-2'],
  filter: ['filter', 'funnel', 'funnel-simple', 'mixer-horizontal'],
  edit: ['pencil', 'pencil-1', 'pencil-simple', 'edit-pencil', 'edit-2', 'edit'],
  lock: ['lock', 'lock-closed', 'lock-key'],
  eye: ['eye', 'eye-open', 'view'],
  'external-link': [
    'external-link', 'arrow-square-out', 'arrow-top-right-on-square',
    'box-arrow-up-right', 'link-external', 'open-new-window',
    'square-arrow-out-up-right', 'share-box',
  ],
};

/**
 * One row per pack. `dir` and `suffix` describe where the variant we want
 * lives; `count` is measured from the real listing of that variant, not
 * copied from a marketing page. `note` is the row's one line of editorial.
 */
const PACKS = [
  {
    id: 'lucide',
    name: 'Lucide',
    license: 'ISC',
    url: 'https://lucide.dev',
    note: 'Feather\u2019s successor. Same 2px round-cap hand, far wider catalog, still shipping.',
    grid: '24',
    weight: '2px stroke',
    source: { kind: 'npm', pkg: 'lucide-static', version: '1.27.0' },
    dir: 'icons/',
    viewBox: '0 0 24 24',
    attrs: {
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    },
  },
  {
    id: 'feather',
    name: 'Feather',
    license: 'MIT',
    url: 'https://feathericons.com',
    note: 'The 2px original most stroke sets descend from. Small, even, no longer growing.',
    grid: '24',
    weight: '2px stroke',
    source: { kind: 'npm', pkg: 'feather-icons', version: '4.29.2' },
    dir: 'dist/icons/',
    viewBox: '0 0 24 24',
    attrs: {
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    },
  },
  {
    id: 'phosphor',
    name: 'Phosphor',
    license: 'MIT',
    url: 'https://phosphoricons.com',
    note: 'Drawn on a 256 grid with a soft geometric hand. Six weights upstream, regular here.',
    grid: '256',
    weight: 'regular weight',
    source: { kind: 'npm', pkg: '@phosphor-icons/core', version: '2.1.1' },
    dir: 'assets/regular/',
    viewBox: '0 0 256 256',
    attrs: { fill: 'currentColor' },
  },
  {
    id: 'heroicons',
    name: 'Heroicons',
    license: 'MIT',
    url: 'https://heroicons.com',
    note: 'Tailwind\u2019s set. 1.5px strokes at 24, with solid and 20px mini twins for dense UI.',
    grid: '24',
    weight: '1.5px stroke',
    source: { kind: 'npm', pkg: 'heroicons', version: '2.2.0' },
    dir: '24/outline/',
    viewBox: '0 0 24 24',
    attrs: {
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.5',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    },
  },
  {
    id: 'tabler',
    name: 'Tabler',
    license: 'MIT',
    url: 'https://tabler.io/icons',
    note: 'The widest stroke catalog here, uniform enough that mixed rows read as one hand.',
    grid: '24',
    weight: '2px stroke',
    source: { kind: 'npm', pkg: '@tabler/icons', version: '3.45.0' },
    dir: 'icons/outline/',
    viewBox: '0 0 24 24',
    attrs: {
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    },
  },
  {
    id: 'radix',
    name: 'Radix Icons',
    license: 'MIT',
    url: 'https://www.radix-ui.com/icons',
    note: 'A 15px grid built for product chrome. Crisp at control size, thin if you scale it up.',
    grid: '15',
    weight: 'filled paths',
    source: { kind: 'gh', repo: 'radix-ui/icons', version: '112af91ad275a63c3a29b0da2588342af74ef9bf' },
    dir: 'packages/radix-icons/icons/',
    viewBox: '0 0 15 15',
    attrs: { fill: 'none' },
  },
  {
    id: 'bootstrap',
    name: 'Bootstrap Icons',
    license: 'MIT',
    url: 'https://icons.getbootstrap.com',
    note: 'Filled paths on a 16 grid, so weight holds at any size. More literal than the stroke sets.',
    grid: '16',
    weight: 'filled paths',
    source: { kind: 'npm', pkg: 'bootstrap-icons', version: '1.13.1' },
    dir: 'icons/',
    exclude: (name) => name.endsWith('-fill'),
    viewBox: '0 0 16 16',
    attrs: { fill: 'currentColor' },
  },
  {
    id: 'iconoir',
    name: 'Iconoir',
    license: 'MIT',
    url: 'https://iconoir.com',
    note: '1.5px strokes on 24 with an open, geometric hand. Roomier than Lucide at the same size.',
    grid: '24',
    weight: '1.5px stroke',
    source: { kind: 'npm', pkg: 'iconoir', version: '7.11.1' },
    dir: 'icons/regular/',
    viewBox: '0 0 24 24',
    attrs: {
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.5',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    },
  },
  {
    id: 'octicons',
    name: 'Octicons',
    license: 'MIT',
    url: 'https://primer.style/octicons',
    note: 'GitHub\u2019s set, redrawn per size rather than scaled. Compact and developer-fluent.',
    grid: '24',
    weight: 'filled paths',
    source: { kind: 'npm', pkg: '@primer/octicons', version: '19.31.0' },
    dir: 'build/svg/',
    suffix: '-24',
    viewBox: '0 0 24 24',
    attrs: { fill: 'currentColor' },
  },
  {
    id: 'hugeicons',
    name: 'Hugeicons',
    license: 'MIT (free core)',
    url: 'https://hugeicons.com',
    note: '1.5px rounded strokes on 24. The free core is one style; the other styles are paid.',
    grid: '24',
    weight: '1.5px stroke',
    source: { kind: 'npm', pkg: '@hugeicons/core-free-icons', version: '4.2.3' },
    dir: 'dist/esm/',
    extension: '.js',
    viewBox: '0 0 24 24',
    attrs: {
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.5',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    },
  },
  {
    id: 'remix',
    name: 'Remix Icon',
    license: 'Apache-2.0',
    url: 'https://remixicon.com',
    note: 'Line and fill twins across a broad catalog. Neutral, a touch heavier than the 2px sets.',
    grid: '24',
    weight: 'filled paths',
    source: { kind: 'npm', pkg: 'remixicon', version: '4.9.1' },
    dir: 'icons/',
    suffix: '-line',
    viewBox: '0 0 24 24',
    attrs: { fill: 'currentColor' },
  },
];

/** Explicit picks where the alias walk lands on a worse glyph, or nothing. */
const OVERRIDES = {
  lucide: { edit: 'pencil', menu: 'menu' },
  feather: { edit: 'edit-3', menu: 'menu' },
  phosphor: { menu: 'list', settings: 'gear-six' },
  // Tabler's menu is two rules, and Bootstrap files the funnel apart from the
  // stacked-rule filter. Both rows compare better against the other nine.
  tabler: { menu: 'menu-2' },
  bootstrap: { menu: 'list', message: 'chat', settings: 'gear', filter: 'funnel' },
  octicons: { menu: 'three-bars', settings: 'gear', message: 'comment' },
  radix: { menu: 'hamburger-menu', settings: 'gear', filter: 'mixer-horizontal' },
  // Iconoir's x.svg is the letter, not the close control.
  iconoir: { close: 'xmark' },
  // Remix files a hand bell under bell and a hex plate under settings, so the
  // two rows that should read as notification and preferences do not.
  remix: { bell: 'notification-2', settings: 'settings-3' },
  // Hugeicons names in PascalCase and numbers its variants, so nothing here is
  // guessable from the concept. Every pick is deliberate.
  hugeicons: {
    home: 'Home01Icon', search: 'Search01Icon', user: 'UserIcon',
    settings: 'Settings01Icon', bell: 'Notification01Icon', heart: 'FavouriteIcon',
    star: 'StarIcon', calendar: 'Calendar01Icon', mail: 'Mail01Icon',
    message: 'BubbleChatIcon', trash: 'Delete02Icon', download: 'Download01Icon',
    upload: 'Upload01Icon', plus: 'Add01Icon', check: 'Tick02Icon',
    close: 'Cancel01Icon', 'chevron-right': 'ChevronRightIcon',
    // ArrowRight01 is Hugeicons' chevron, and LockIcon is a keyhole disc.
    'arrow-right': 'ArrowRight02Icon', menu: 'Menu01Icon', filter: 'FilterIcon',
    edit: 'PencilEdit01Icon', lock: 'SquareLock01Icon', eye: 'ViewIcon',
    'external-link': 'ExternalLinkIcon',
  },
};

const ALLOWED_TAGS = new Set([
  'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'g',
]);
const ALLOWED_ATTRS = new Set([
  'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'width', 'height', 'points', 'transform', 'fill', 'fill-rule', 'clip-rule',
  'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-miterlimit', 'stroke-dasharray', 'opacity', 'fill-opacity',
  'stroke-opacity',
]);

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function getText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

/** Resolve the version to pin, then list every file the package ships. */
async function listFiles(pack) {
  const source = useLatest ? { ...pack.source, version: null } : pack.source;
  if (source.kind === 'npm') {
    const version = source.version
      || (await getJson(`https://data.jsdelivr.com/v1/packages/npm/${source.pkg}`)).tags.latest;
    const listing = await getJson(
      `https://data.jsdelivr.com/v1/packages/npm/${source.pkg}@${version}?structure=flat`,
    );
    return {
      version,
      base: `https://cdn.jsdelivr.net/npm/${source.pkg}@${version}`,
      files: listing.files.map((file) => file.name.replace(/^\//, '')),
    };
  }
  // GitHub sources are pinned to a commit: branches move, and a specimen that
  // silently redraws itself is worse than one that fails loudly.
  const version = source.version
    || (await getJson(`https://api.github.com/repos/${source.repo}/commits/HEAD`)).sha;
  const tree = await getJson(
    `https://api.github.com/repos/${source.repo}/git/trees/${version}?recursive=1`,
  );
  return {
    version,
    base: `https://raw.githubusercontent.com/${source.repo}/${version}`,
    files: tree.tree.filter((node) => node.type === 'blob').map((node) => node.path),
  };
}

function basenames(pack, files) {
  const extension = pack.extension || '.svg';
  const map = new Map();
  for (const file of files) {
    if (!file.startsWith(pack.dir) || !file.endsWith(extension)) continue;
    const name = file.slice(pack.dir.length, -extension.length);
    // Remix nests by category (icons/system/home-line.svg); everything else is
    // flat, and a nested name would only collide with itself.
    map.set(name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name, file);
  }
  return map;
}

function variantNames(pack, names) {
  const suffix = pack.suffix || '';
  return [...names]
    .filter((name) => name.endsWith(suffix))
    .filter((name) => !pack.exclude?.(name));
}

function resolveName(pack, concept, names) {
  const suffix = pack.suffix || '';
  const override = OVERRIDES[pack.id]?.[concept];
  const candidates = override ? [override] : ALIASES[concept];
  for (const candidate of candidates) {
    for (const name of [
      `${candidate}${suffix}`,
      candidate,
      `${candidate}-01${suffix}`,
      `${candidate}-1${suffix}`,
    ]) {
      if (names.has(name) && !pack.exclude?.(name)) return name;
    }
  }
  return null;
}

/** Keep drawing elements and drawing attributes. Drop everything else. */
function sanitize(markup) {
  const body = markup
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<(title|desc|style|script|metadata)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?svg\b[^>]*>/gi, '');

  let dropped = 0;
  const cleaned = body.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g, (match, rawTag, rawAttrs) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      dropped += 1;
      return '';
    }
    if (match.startsWith('</')) return `</${tag}>`;

    // Names carry digits (x1, y2), so the class cannot be letters only.
    const attrs = [...rawAttrs.matchAll(/([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*"([^"]*)"/g)]
      .map(([, key, value]) => [key.toLowerCase(), value.trim()])
      .filter(([key]) => ALLOWED_ATTRS.has(key));
    // Tabler opens every icon with an invisible bounding path, and a few packs
    // carry the same trick. It draws nothing, so it only costs bytes.
    const paint = Object.fromEntries(attrs);
    if (paint.fill === 'none' && paint.stroke === 'none') return '';
    if (paint.opacity === '0') return '';

    const rendered = attrs.map(([key, value]) => `${key}="${value}"`).join(' ');
    const selfClosing = match.endsWith('/>');
    return `<${tag}${rendered ? ` ${rendered}` : ''}${selfClosing ? '/>' : '>'}`;
  });

  return { body: cleaned.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim(), dropped };
}

/**
 * Hugeicons ships React-shaped tuples rather than SVG files:
 * [["path", { d: "...", key: "0" }], ...]. Same drawing, one hop away.
 */
function tuplesToMarkup(module) {
  const start = module.indexOf('[', module.indexOf('='));
  const end = module.lastIndexOf(']');
  if (start === -1 || end < start) throw new Error('No icon tuple array found');
  const literal = module
    .slice(start, end + 1)
    .replace(/([{,])\s*([A-Za-z][A-Za-z0-9]*)\s*:/g, '$1"$2":');

  const tuples = JSON.parse(literal);
  return tuples
    .map(([tag, props]) => {
      const attrs = Object.entries(props)
        .filter(([key]) => key !== 'key')
        .map(([key, value]) => [key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), value])
        .map(([key, value]) => `${key}="${value}"`)
        .join(' ');
      return `<${tag} ${attrs}/>`;
    })
    .join('');
}

const rootAttr = (markup, name) => markup.match(new RegExp(`<svg[^>]*\\b${name}="([^"]*)"`, 'i'))?.[1];

async function vendorPack(pack) {
  const { version, base, files } = await listFiles(pack);
  const names = basenames(pack, files);
  const count = variantNames(pack, names.keys()).length;
  if (!count) throw new Error(`${pack.id}: no files under ${pack.dir}`);

  const glyphs = [];
  const misses = [];
  let droppedTotal = 0;
  let viewBoxMismatch = null;

  for (const concept of CONCEPTS) {
    const name = resolveName(pack, concept, names);
    if (!name) {
      misses.push(concept);
      continue;
    }
    const raw = await getText(`${base}/${encodeURI(names.get(name))}`);
    const markup = pack.extension === '.js' ? tuplesToMarkup(raw) : raw;
    if (pack.extension !== '.js') {
      const viewBox = rootAttr(markup, 'viewBox');
      if (viewBox && viewBox !== pack.viewBox) viewBoxMismatch ??= `${name}: ${viewBox}`;
    }
    const { body, dropped } = sanitize(markup);
    droppedTotal += dropped;
    if (!body) throw new Error(`${pack.id}/${name}: sanitized to nothing`);
    glyphs.push({ concept, name, body });
  }

  return {
    pack: {
      id: pack.id,
      name: pack.name,
      license: pack.license,
      url: pack.url,
      note: pack.note,
      grid: pack.grid,
      weight: pack.weight,
      count,
      version,
      viewBox: pack.viewBox,
      attrs: pack.attrs,
      glyphs,
    },
    report: { misses, dropped: droppedTotal, viewBoxMismatch },
  };
}

const results = await Promise.all(PACKS.map(async (pack) => {
  try {
    return { pack, ...(await vendorPack(pack)) };
  } catch (error) {
    return { pack, error };
  }
}));

let failed = false;
const packs = [];
for (const result of results) {
  if (result.error) {
    failed = true;
    console.error(`FAIL ${result.pack.id}: ${result.error.message}`);
    continue;
  }
  const { pack, report } = result;
  packs.push(pack);
  const flags = [
    report.misses.length ? `MISSING ${report.misses.join(', ')}` : null,
    report.viewBoxMismatch ? `VIEWBOX ${report.viewBoxMismatch}` : null,
    report.dropped ? `dropped ${report.dropped} tags` : null,
  ].filter(Boolean);
  if (report.misses.length) failed = true;
  console.log(
    `${pack.id.padEnd(11)} v${String(pack.version).slice(0, 12).padEnd(13)}`
    + `${String(pack.count).padStart(5)} glyphs  ${pack.glyphs.length}/${CONCEPTS.length}`
    + `${flags.length ? `  ${flags.join(' | ')}` : ''}`,
  );
  console.log(`  ${pack.glyphs.map((glyph) => `${glyph.concept}=${glyph.name}`).join('  ')}`);
}

if (!dryRun && packs.length) {
  const payload = {
    generated: new Date().toISOString().slice(0, 10),
    concepts: CONCEPTS,
    packs,
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload)}\n`);
  const bytes = Buffer.byteLength(JSON.stringify(payload));
  console.log(`\nWrote ${path.relative(root, outputPath)} (${(bytes / 1024).toFixed(0)} KB)`);
}

process.exit(failed ? 1 : 0);
