
/* Shared inventory for the previews gallery (plan-6). Used by
   capture-previews.mjs, build-gallery.mjs, and verify-previews-gallery.mjs.
   All values are quoted from the picker source and the hanazono-atelier run;
   see tmp/questionaire/plans/plan-6-previews-gallery.md for the anchors. */

export const VIEWPORT = { width: 1600, height: 1000 };

export const SURFACE_LABEL = {
  persuade: 'Landing page',
  operate: 'App UI',
  read: 'Docs',
  experience: 'Portfolio',
};

export const TILE_INDEX = { persuade: 1, operate: 2, read: 3, experience: 4 };

export const PALETTE_PRESETS = [
  { id: 'zinc-dawn', primary: '#175558', secondary: '#587570', tertiary: '#C9534C', neutral: '#E9EBEA' },
  { id: 'lacquer-glow', primary: '#1E1914', secondary: '#6D5848', tertiary: '#D5842C', neutral: '#F1EBE2' },
  { id: 'margin-stems', primary: '#5D4975', secondary: '#6A8E7A', tertiary: '#2E8562', neutral: '#EEEAE4' },
  { id: 'clay-bench', primary: '#C65A36', secondary: '#9A7056', tertiary: '#EA3871', neutral: '#F3E6DD' },
];

export const FONT_PRESETS = [
  { id: 'cormorant-source', name: 'Cormorant + Source Sans 3', heading: { family: 'Cormorant Garamond', weight: 600 }, body: { family: 'Source Sans 3', weight: 400 } },
  { id: 'playfair-work', name: 'Playfair + Work Sans', heading: { family: 'Playfair Display', weight: 600 }, body: { family: 'Work Sans', weight: 400 } },
  { id: 'libre-plex', name: 'Libre Baskerville + IBM Plex Sans', heading: { family: 'Libre Baskerville', weight: 700 }, body: { family: 'IBM Plex Sans', weight: 400 } },
  { id: 'source-serif-pair', name: 'Source Serif 4 + Source Sans 3', heading: { family: 'Source Serif 4', weight: 600 }, body: { family: 'Source Sans 3', weight: 400 } },
];

/* Per-surface defaults for every radio group the picker CSS reads, plus the
   flat groups. Motion and layout are not asked of operate/read; the live
   picker parks their radios on the leading applicable surface (persuade). */
export const DEFAULTS = {
  persuade: { 'color-strategy': 'full-palette', 'motion-energy': 'responsive', 'layout-structure': 'balanced', 'boundary-style': 'open-space', 'corner-style': 'slightly-soft', 'depth-style': 'soft-lift', 'type-scale': 'major-third', 'font-pair': 'cormorant-source', 'icon-pack': 'lucide' },
  operate: { 'color-strategy': 'full-palette', 'motion-energy': 'responsive', 'layout-structure': 'balanced', 'boundary-style': 'surface-changes', 'corner-style': 'slightly-soft', 'depth-style': 'flat', 'type-scale': 'major-third', 'font-pair': 'cormorant-source', 'icon-pack': 'lucide' },
  read: { 'color-strategy': 'full-palette', 'motion-energy': 'responsive', 'layout-structure': 'balanced', 'boundary-style': 'open-space', 'corner-style': 'slightly-soft', 'depth-style': 'flat', 'type-scale': 'major-third', 'font-pair': 'cormorant-source', 'icon-pack': 'lucide' },
  experience: { 'color-strategy': 'restrained', 'motion-energy': 'choreographed', 'layout-structure': 'simple-grid', 'boundary-style': 'open-space', 'corner-style': 'sharp', 'depth-style': 'flat', 'type-scale': 'major-third', 'font-pair': 'cormorant-source', 'icon-pack': 'lucide' },
};

/* Sections in questionnaire order, cells fully enumerated. Captions are the
   authoritative labels from plan-6's inventory tables. */
export const SECTIONS = [
  {
    id: 'surfaces', screen: '01b', title: 'Surfaces (screen 01b)', group: null,
    stageSelector: '.picker-mode-tile',
    cells: [
      { surface: 'persuade', option: null, caption: 'Selected: Landing page' },
      { surface: 'operate', option: null, caption: 'Selected: App UI' },
      { surface: 'read', option: null, caption: 'Selected: Docs' },
      { surface: 'experience', option: null, caption: 'Selected: Portfolio' },
    ],
  },
  {
    id: 'palette', screen: '02', title: 'Color palette (screen 02)', group: null,
    stageSelector: '.picker-palette-panel .picker-preview',
    cells: [
      { surface: 'persuade', option: null, caption: 'Selected: Landing page + Palette preview' },
      { surface: 'operate', option: null, caption: 'Selected: App UI + Palette preview' },
      { surface: 'read', option: null, caption: 'Selected: Docs + Palette preview' },
      { surface: 'experience', option: null, caption: 'Selected: Portfolio + Palette preview' },
    ],
  },
  {
    id: 'strategy', screen: '03', title: 'Color strategy (screen 03)', group: 'color-strategy',
    stageSelector: '.picker-strategy-stage',
    previewSelector: '.picker-strategy-stage > .picker-preview:not([hidden])',
    cells: [
      { surface: 'persuade', option: 'restrained', caption: 'Selected: Landing page + Restrained' },
      { surface: 'persuade', option: 'committed', caption: 'Selected: Landing page + Committed' },
      { surface: 'persuade', option: 'full-palette', caption: 'Selected: Landing page + Full palette' },
      { surface: 'persuade', option: 'drenched', caption: 'Selected: Landing page + Drenched' },
      { surface: 'operate', option: 'restrained', caption: 'Selected: App UI + Restrained' },
      { surface: 'operate', option: 'committed', caption: 'Selected: App UI + Committed' },
      { surface: 'operate', option: 'full-palette', caption: 'Selected: App UI + Full palette' },
      { surface: 'read', option: 'restrained', caption: 'Selected: Docs + Restrained' },
      { surface: 'read', option: 'committed', caption: 'Selected: Docs + Committed' },
      { surface: 'read', option: 'full-palette', caption: 'Selected: Docs + Full palette' },
      { surface: 'experience', option: 'restrained', caption: 'Selected: Portfolio + Restrained' },
      { surface: 'experience', option: 'committed', caption: 'Selected: Portfolio + Committed' },
      { surface: 'experience', option: 'drenched', caption: 'Selected: Portfolio + Drenched' },
    ],
  },
  {
    id: 'font-pair', screen: '04', title: 'Font pair (screen 04)', group: 'font-pair',
    stageSelector: '.picker-type-stage',
    previewSelector: '.picker-type-stage > .picker-artboard:not([hidden])',
    cells: [
      { surface: 'persuade', option: null, caption: 'Selected: Landing page + Font pair' },
      { surface: 'operate', option: null, caption: 'Selected: App UI + Font pair' },
      { surface: 'read', option: null, caption: 'Selected: Docs + Font pair' },
      { surface: 'experience', option: null, caption: 'Selected: Portfolio + Font pair' },
    ],
  },
  {
    id: 'motion', screen: '06', title: 'Motion (screen 06)', group: 'motion-energy',
    stageSelector: '.picker-board-stage',
    previewSelector: '.picker-board-stage > .picker-artboard:not([hidden])',
    cells: [
      { surface: 'persuade', option: 'restrained', caption: 'Selected: Landing page + Restrained' },
      { surface: 'persuade', option: 'responsive', caption: 'Selected: Landing page + Responsive' },
      { surface: 'persuade', option: 'choreographed', caption: 'Selected: Landing page + Choreographed' },
      { surface: 'experience', option: 'restrained', caption: 'Selected: Portfolio + Restrained' },
      { surface: 'experience', option: 'responsive', caption: 'Selected: Portfolio + Responsive' },
      { surface: 'experience', option: 'choreographed', caption: 'Selected: Portfolio + Choreographed' },
    ],
  },
  {
    id: 'layout', screen: '07', title: 'Layout (screen 07)', group: 'layout-structure',
    stageSelector: '.picker-board-stage',
    previewSelector: '.picker-board-stage > .picker-artboard:not([hidden])',
    cells: [
      { surface: 'persuade', option: 'simple-grid', caption: 'Selected: Landing page + Simple grid' },
      { surface: 'persuade', option: 'balanced', caption: 'Selected: Landing page + Balanced' },
      { surface: 'persuade', option: 'freeform', caption: 'Selected: Landing page + Freeform' },
      { surface: 'experience', option: 'simple-grid', caption: 'Selected: Portfolio + Simple grid' },
      { surface: 'experience', option: 'balanced', caption: 'Selected: Portfolio + Balanced' },
      { surface: 'experience', option: 'freeform', caption: 'Selected: Portfolio + Freeform' },
    ],
  },
  {
    id: 'boundaries', screen: '08', title: 'Boundaries (screen 08)', group: 'boundary-style',
    stageSelector: '.picker-board-stage',
    previewSelector: '.picker-board-stage > .picker-artboard:not([hidden])',
    cells: [
      { surface: 'persuade', option: 'open-space', caption: 'Selected: Landing page + Open space' },
      { surface: 'persuade', option: 'thin-dividers', caption: 'Selected: Landing page + Thin dividers' },
      { surface: 'persuade', option: 'surface-changes', caption: 'Selected: Landing page + Surface changes' },
      { surface: 'persuade', option: 'cards-and-panels', caption: 'Selected: Landing page + Cards and panels' },
      { surface: 'operate', option: 'thin-dividers', caption: 'Selected: App UI + Thin dividers' },
      { surface: 'operate', option: 'surface-changes', caption: 'Selected: App UI + Surface changes' },
      { surface: 'operate', option: 'cards-and-panels', caption: 'Selected: App UI + Cards and panels' },
      { surface: 'read', option: 'open-space', caption: 'Selected: Docs + Open space' },
      { surface: 'read', option: 'thin-dividers', caption: 'Selected: Docs + Thin dividers' },
      { surface: 'read', option: 'surface-changes', caption: 'Selected: Docs + Surface changes' },
      { surface: 'experience', option: 'open-space', caption: 'Selected: Portfolio + Open space' },
      { surface: 'experience', option: 'thin-dividers', caption: 'Selected: Portfolio + Thin dividers' },
      { surface: 'experience', option: 'surface-changes', caption: 'Selected: Portfolio + Surface changes' },
    ],
  },
  {
    id: 'corners', screen: '09', title: 'Corners (screen 09)', group: 'corner-style',
    stageSelector: '.picker-board-stage',
    previewSelector: '.picker-board-stage > .picker-artboard:not([hidden])',
    cells: [
      { surface: 'persuade', option: 'sharp', caption: 'Selected: Landing page + Sharp' },
      { surface: 'persuade', option: 'slightly-soft', caption: 'Selected: Landing page + Slightly soft' },
      { surface: 'persuade', option: 'friendly', caption: 'Selected: Landing page + Friendly' },
      { surface: 'persuade', option: 'pill', caption: 'Selected: Landing page + Pill-like' },
      { surface: 'operate', option: 'sharp', caption: 'Selected: App UI + Sharp' },
      { surface: 'operate', option: 'slightly-soft', caption: 'Selected: App UI + Slightly soft' },
      { surface: 'operate', option: 'friendly', caption: 'Selected: App UI + Friendly' },
      { surface: 'operate', option: 'pill', caption: 'Selected: App UI + Pill-like' },
      { surface: 'read', option: 'sharp', caption: 'Selected: Docs + Sharp' },
      { surface: 'read', option: 'slightly-soft', caption: 'Selected: Docs + Slightly soft' },
      { surface: 'read', option: 'friendly', caption: 'Selected: Docs + Friendly' },
      { surface: 'read', option: 'pill', caption: 'Selected: Docs + Pill-like' },
      { surface: 'experience', option: 'sharp', caption: 'Selected: Portfolio + Sharp' },
      { surface: 'experience', option: 'slightly-soft', caption: 'Selected: Portfolio + Slightly soft' },
      { surface: 'experience', option: 'friendly', caption: 'Selected: Portfolio + Friendly' },
    ],
  },
  {
    id: 'depth', screen: '10', title: 'Depth (screen 10)', group: 'depth-style',
    stageSelector: '.picker-board-stage',
    previewSelector: '.picker-board-stage > .picker-artboard:not([hidden])',
    cells: [
      { surface: 'persuade', option: 'flat', caption: 'Selected: Landing page + Flat' },
      { surface: 'persuade', option: 'soft-lift', caption: 'Selected: Landing page + Soft lift' },
      { surface: 'persuade', option: 'floating', caption: 'Selected: Landing page + Floating' },
      { surface: 'operate', option: 'flat', caption: 'Selected: App UI + Flat' },
      { surface: 'operate', option: 'soft-lift', caption: 'Selected: App UI + Soft lift' },
      { surface: 'read', option: 'flat', caption: 'Selected: Docs + Flat' },
      { surface: 'read', option: 'soft-lift', caption: 'Selected: Docs + Soft lift' },
      { surface: 'experience', option: 'flat', caption: 'Selected: Portfolio + Flat' },
      { surface: 'experience', option: 'soft-lift', caption: 'Selected: Portfolio + Soft lift' },
      { surface: 'experience', option: 'floating', caption: 'Selected: Portfolio + Floating' },
    ],
  },
];

/* Flat list with ids, per-cell form state, and builder metadata. */
export const CELL_LIST = [];
for (const section of SECTIONS) {
  for (const cell of section.cells) {
    const id = section.id + '--' + (cell.surface ?? 'all') + '--' + (cell.option ?? 'default');
    const formState = { ...DEFAULTS[cell.surface ?? 'persuade'] };
    if (section.group && cell.option) formState[section.group] = cell.option;
    CELL_LIST.push({
      id,
      section: section.id,
      screen: section.screen,
      surface: cell.surface ?? null,
      option: cell.option ?? null,
      caption: cell.caption,
      variantKey: section.id === 'palette' ? cell.surface : section.id === 'icons' ? cell.option : null,
      tileIndex: section.id === 'surfaces' ? TILE_INDEX[cell.surface] : null,
      formState,
    });
  }
}

export const refName = (cell) =>
  cell.section + '--' + (cell.surface ?? 'all') + '--' + (cell.option ?? 'default') + '.png';