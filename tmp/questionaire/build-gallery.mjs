
/* Plan 6 builder. Reads capture.json and writes previews-gallery.html: one
   self-contained page with a sticky control bar (palette presets 1-4, per
   role custom color inputs, font presets 1-4, jump navigation) over 86 cells,
   each an iframe rebuilt from the captured ground truth. Zero runtime network
   requests: all CSS resources are data URIs and every captured <img> is
   neutralized. */

import { readFile, writeFile } from 'node:fs/promises';
import { CELL_LIST, FONT_PRESETS, PALETTE_PRESETS, SECTIONS } from './gallery-cells.mjs';

const OUT_DIR = '/Users/abdulwahab/impeccable/tmp/questionaire';
const BLANK_GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

const neutralizeImages = (html) =>
  html.replace(/(<img\b[^>]*?\bsrc=")[^"]*(")/g, '$1' + BLANK_GIF + '$2');

/* One external form-state block per cell: every radio group the picker CSS
   can read, except the group whose radios already live inside the captured
   section markup, plus the committed palette fields. surface-modes checkboxes
   are added except on screen 01b, whose section carries its own. */
function externalInputs(cell) {
  const parts = [];
  if (cell.screen !== '01b') {
    for (const s of ['persuade', 'operate', 'read', 'experience']) {
      parts.push('<input type="checkbox" name="surface-modes" value="' + s + '"' + (s === cell.surface ? ' checked' : '') + '>');
    }
  }
  parts.push('<input type="hidden" name="palette-source" value="zinc-dawn">');
  for (const role of ['primary', 'secondary', 'tertiary', 'neutral']) {
    parts.push('<input type="hidden" name="palette-' + role + '" value="' + PALETTE_PRESETS[0][role] + '">');
  }
  const sectionGroup = SECTIONS.find((s) => s.id === cell.section).group;
  for (const [group, value] of Object.entries(cell.formState)) {
    if (group === sectionGroup) continue;
    parts.push('<input type="radio" name="' + group + '" value="' + value + '" checked>');
  }
  return parts.join('');
}

/* The standalone document each cell iframe runs. Same placeholder scheme as
   tmp/motion-previews-premium.html. */
const IFRAME_TEMPLATE = [
  '<!doctype html>',
  '<html lang="en" class="dark" data-cell-screen="__SCREEN__" data-cell-surface="__SURFACE__" data-cell-option="__OPTION__">',
  '<head><meta charset="utf-8">',
  '__CSS__',
  '<style data-origin="standalone-override">',
  'html, body { margin: 0; padding: 0; overflow: hidden; }',
  '.picker-question-title, .picker-question-head, .picker-type-rail, .picker-actions-stack, .picker-actions,',
  '.picker-back, .picker-surface-tabs, .picker-modes-note, .picker-deck-column, .picker-bands,',
  '.picker-band-status, .picker-palette-hint, .picker-reset, .picker-ring-guide, .picker-loupe,',
  '.picker-type-controls, .picker-type-scroll, .picker-icon-options, .picker-progress, .picker-key-hint,',
  '#picker-form legend { display: none !important; }',
  'main.picker-shell, #picker-form, .picker-screen, .picker-container, .picker-strategy, .picker-strategy-grid,',
  '.picker-modes, .picker-modes-grid, .picker-palette, .picker-palette-grid, .picker-palette-subgrid,',
  '.picker-palette-panel, .picker-type, .picker-type-grid, .picker-icons, .picker-icons-grid {',
  '  display: block !important; padding: 0 !important; margin: 0 !important; border: 0 !important;',
  '  max-width: none !important; min-height: 0 !important; gap: 0 !important; justify-items: start !important;',
  '  height: auto !important; overflow: visible !important; contain: none !important; background: transparent !important;',
  '}',
  '__STAGE_CSS__',
  '<\/style>',
  '<\/head>',
  '<body class="picker-page" style="--pk-foil: url(__FOIL__)">',
  '<main class="picker-shell">',
  '<form id="picker-form" data-current="__SCREEN__">',
  '<div hidden data-origin="external-form-state">__EXTERNAL__<\/div>',
  '__SECTION__',
  '<\/form>',
  '<\/main>',
  '<script>__SCRIPT__<\/script>',
  '<\/body><\/html>',
].join('\n');

/* Runs inside every cell. Applies the cell form state, shows the cell's
   surface board, exposes the repaint hooks, and (screen 06 only) carries the
   premium file's motion route plotting and hover replay verbatim. */
const IFRAME_SCRIPT = [
  'var FORM_STATE = __FORM_STATE_JSON__;',
  'var CELL = __CELL_JSON__;',
  'Object.keys(FORM_STATE).forEach(function (group) {',
  '  var value = FORM_STATE[group];',
  '  var inputs = document.querySelectorAll(\'input[name="\' + group + \'"]\');',
  '  Array.prototype.forEach.call(inputs, function (input) {',
  '    input.disabled = false;',
  '    input.checked = input.value === value;',
  '  });',
  '});',
  'if (CELL.surface) {',
  '  Array.prototype.forEach.call(document.querySelectorAll(\'input[name="surface-modes"]\'), function (input) {',
  '    input.checked = input.value === CELL.surface;',
  '  });',
  '  Array.prototype.forEach.call(document.querySelectorAll(\'.picker-screen [data-surface]\'), function (node) {',
  '    var active = node.getAttribute(\'data-surface\') === CELL.surface;',
  '    if (active) node.removeAttribute(\'hidden\'); else node.setAttribute(\'hidden\', \'\');',
  '    node.setAttribute(\'aria-hidden\', active ? \'false\' : \'true\');',
  '  });',
  '}',
  'window.__applyPalette = function (vars) {',
  '  var targets = document.querySelectorAll(\'[data-artboard], .picker-mode-preview--exact > .picker-preview, .picker-palette-panel .picker-preview\');',
  '  Array.prototype.forEach.call(targets, function (node) {',
  '    Object.keys(vars).forEach(function (key) { node.style.setProperty(\'--pv-\' + key, vars[key]); });',
  '  });',
  '  Array.prototype.forEach.call(document.querySelectorAll(\'[data-surface-stage]\'), function (stage) {',
  '    Object.keys(vars).forEach(function (key) { stage.style.setProperty(\'--pkc-\' + key, vars[key]); });',
  '  });',
  '};',
  'window.__applyFonts = function (font) {',
  '  Array.prototype.forEach.call(document.querySelectorAll(\'[data-type-stage]\'), function (stage) {',
  '    stage.style.setProperty(\'--pt-heading\', font.heading);',
  '    stage.style.setProperty(\'--pt-body\', font.body);',
  '    stage.style.setProperty(\'--pt-heading-weight\', font.headingWeight);',
  '  });',
  '};',
  'if (CELL.screen === \'06\') {',
  '  var MOTION_STOPS = {',
  '    \'--mtr-nav1\': \'.ps-nav-bars i:nth-child(1)\',',
  '    \'--mtr-nav2\': \'.ps-nav-bars i:nth-child(2)\',',
  '    \'--mtr-cta1\': \'.ps-actions i:first-child\',',
  '    \'--mtr-cta2\': \'.ps-actions i:last-child\',',
  '    \'--mtr-card1\': \'.ps-gallery-item:nth-child(1) > i\',',
  '    \'--mxi-work1\': \'.ps-index-row:nth-of-type(1) > .ps-image\',',
  '    \'--mxi-work2\': \'.ps-index-row:nth-of-type(2) > .ps-image\',',
  '    \'--mxi-rail\': \'.ps-index-arrow--next\',',
  '  };',
  '  var motionScenes = Array.prototype.slice.call(document.querySelectorAll(\'.picker-preview-motion\'));',
  '  var plotMotionRoute = function (scene) {',
  '    var boards = scene ? [scene] : motionScenes;',
  '    boards.forEach(function (board) {',
  '      var desk = board.querySelector(\'.ps-desktop\');',
  '      if (!desk || !desk.clientWidth) return;',
  '      var center = function (el) {',
  '        var x = el.offsetWidth / 2;',
  '        var y = el.offsetHeight / 2;',
  '        for (var node = el; node && node !== desk; node = node.offsetParent) {',
  '          x += node.offsetLeft;',
  '          y += node.offsetTop;',
  '        }',
  '        return { x: (x / desk.clientWidth) * 100, y: (y / desk.clientHeight) * 100 };',
  '      };',
  '      Object.keys(MOTION_STOPS).forEach(function (name) {',
  '        var el = desk.querySelector(MOTION_STOPS[name]);',
  '        if (!el) return;',
  '        var c = center(el);',
  '        board.style.setProperty(name, c.x.toFixed(2) + \'cqw \' + c.y.toFixed(2) + \'cqh\');',
  '      });',
  '      var nav1 = desk.querySelector(\'.ps-nav-bars i:nth-child(1)\');',
  '      board.style.setProperty(\'--mtr-entry\', center(nav1).x.toFixed(2) + \'cqw -8cqh\');',
  '    });',
  '  };',
  '  motionScenes.forEach(function (scene) {',
  '    new ResizeObserver(function () { plotMotionRoute(scene); }).observe(scene.querySelector(\'.ps-desktop\'));',
  '  });',
  '  plotMotionRoute();',
  '  window.__replayMotion = function () {',
  '    motionScenes.forEach(function (scene) {',
  '      scene.getAnimations({ subtree: true }).forEach(function (animation) {',
  '        animation.cancel();',
  '        animation.play();',
  '      });',
  '    });',
  '  };',
  '}',
].join('\n');

/* The host page runtime: color math verbatim from picker/scripts/color.js
   (template literals rewritten to concatenation), fontStack verbatim from
   picker/scripts/palette-picker.js, plus the control bar wiring. */
const HOST_RUNTIME = [
  'var PAYLOAD = JSON.parse(document.getElementById(\'gallery-payload\').textContent);',
  '',
  '/* ---- color.js, verbatim (concatenation instead of template literals) */',
  'var clamp = function (value) { return Math.min(1, Math.max(0, value)); };',
  'var linearize = function (value) { return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4); };',
  'var gamma = function (value) { return value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055; };',
  'var parseHex = function (hex) { return hex.match(/[\\da-f]{2}/gi).map(function (value) { return Number.parseInt(value, 16) / 255; }); };',
  'function toLinearRgb(lch) {',
  '  var L = lch[0], C = lch[1], H = lch[2];',
  '  var angle = H * Math.PI / 180;',
  '  var a = C * Math.cos(angle);',
  '  var b = C * Math.sin(angle);',
  '  var l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);',
  '  var m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);',
  '  var s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);',
  '  return [',
  '    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,',
  '    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,',
  '    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,',
  '  ];',
  '}',
  'function oklchToHex(lch) {',
  '  var L = clamp(lch[0]);',
  '  var C = Math.max(0, lch[1]);',
  '  var hue = lch[2];',
  '  var rgb = toLinearRgb([L, C, hue]);',
  '  while (C > 0 && rgb.some(function (channel) { return channel < 0 || channel > 1; })) {',
  '    C = Math.max(0, C - 0.005);',
  '    rgb = toLinearRgb([L, C, hue]);',
  '  }',
  '  return \'#\' + rgb.map(function (channel) {',
  '    return Math.round(clamp(gamma(channel)) * 255).toString(16).padStart(2, \'0\');',
  '  }).join(\'\').toUpperCase();',
  '}',
  'function hexToOklch(hex) {',
  '  var rgb = parseHex(hex).map(linearize);',
  '  var red = rgb[0], green = rgb[1], blue = rgb[2];',
  '  var l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);',
  '  var m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);',
  '  var s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);',
  '  var L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;',
  '  var a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;',
  '  var b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;',
  '  var C = Math.hypot(a, b);',
  '  return [L, C, C < 0.00001 ? 0 : (Math.atan2(b, a) * 180 / Math.PI + 360) % 360];',
  '}',
  'var INK_DARK_LUMINANCE = 0.0027;',
  'var INK_LIGHT_LUMINANCE = 0.9716;',
  'function relativeLuminance(hex) {',
  '  var rgb = parseHex(hex).map(linearize);',
  '  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];',
  '}',
  'function ratio(a, b) {',
  '  var hi = a > b ? a : b;',
  '  var lo = a > b ? b : a;',
  '  return (hi + 0.05) / (lo + 0.05);',
  '}',
  'function contrastInk(hex) {',
  '  var swatch = relativeLuminance(hex);',
  '  var against = function (ink) { return ratio(ink, swatch); };',
  '  return against(INK_DARK_LUMINANCE) >= against(INK_LIGHT_LUMINANCE)',
  '    ? \'var(--pk-ink-dark)\'',
  '    : \'var(--pk-ink-light)\';',
  '}',
  'function contrastInkHex(hex) {',
  '  return contrastInk(hex).includes(\'light\')',
  '    ? oklchToHex([0.99, 0.008, 95])',
  '    : oklchToHex([0.14, 0.018, 95]);',
  '}',
  'function readableOn(accent, ground, target) {',
  '  if (target === undefined) target = 4.5;',
  '  var groundLuminance = relativeLuminance(ground);',
  '  if (ratio(relativeLuminance(accent), groundLuminance) >= target) return accent;',
  '  var lch = hexToOklch(accent);',
  '  var L = lch[0], C = lch[1], H = lch[2];',
  '  var darker = ratio(INK_DARK_LUMINANCE, groundLuminance) >= ratio(INK_LIGHT_LUMINANCE, groundLuminance);',
  '  var step = darker ? -0.015 : 0.015;',
  '  for (var lightness = L + step; lightness > 0.03 && lightness < 1; lightness += step) {',
  '    var candidate = oklchToHex([lightness, C, H]);',
  '    if (ratio(relativeLuminance(candidate), groundLuminance) >= target) return candidate;',
  '  }',
  '  return darker ? \'#000000\' : \'#FFFFFF\';',
  '}',
  '',
  '/* ---- fontStack, verbatim from palette-picker.js lines 216-217 */',
  'var serifFamily = /serif|mincho|baskerville|bitter|marcellus|slab|antiqua|garamond|didot|bodoni/i;',
  'var fontStack = function (family) {',
  '  return \'"\' + family.replaceAll(\'"\', \'\\\\"\') + \'", \' + (serifFamily.test(family) ? \'serif\' : \'sans-serif\');',
  '};',
  '',
  '/* ---- cell documents */',
  'var CSS_BLOCKS = PAYLOAD.cssSources.map(function (c) {',
  '  return \'<style data-origin=\' + JSON.stringify(c.from) + \'>\\n\' + c.text + \'\\n<\' + \'/style>\';',
  '}).join(\'\\n\');',
  'var fill = function (text, key, value) { return text.split(key).join(value); };',
  'function buildDoc(cell) {',
  '  var section = PAYLOAD.sections[cell.section];',
  '  var html = cell.variantKey ? section.variants[cell.variantKey] : section.sectionHtml;',
  '  var stageSel = cell.tileIndex ? \'.picker-mode-tile:nth-of-type(\' + cell.tileIndex + \')\' : section.stageSelector;',
  '  var stageCss = stageSel + \' { width: \' + section.dims.width + \'px !important; height: \' + section.dims.height + \'px !important; }\';',
  '  if (cell.tileIndex) {',
  '    stageCss += \'\\n.picker-mode-tile:not(:nth-of-type(\' + cell.tileIndex + \')) { display: none !important; }\';',
  '  }',
  '  var script = fill(fill(PAYLOAD.iframeScript,',
  '    \'__FORM_STATE_JSON__\', JSON.stringify(cell.formState)),',
  '    \'__CELL_JSON__\', JSON.stringify({ section: cell.section, screen: cell.screen, surface: cell.surface, option: cell.option }));',
  '  var doc = PAYLOAD.iframeTemplate;',
  '  doc = fill(doc, \'__SCREEN__\', cell.screen);',
  '  doc = fill(doc, \'__SURFACE__\', cell.surface || \'\');',
  '  doc = fill(doc, \'__OPTION__\', cell.option || \'\');',
  '  doc = fill(doc, \'__FOIL__\', PAYLOAD.foilDataUri);',
  '  doc = fill(doc, \'__STAGE_CSS__\', stageCss);',
  '  doc = fill(doc, \'__EXTERNAL__\', cell.externalHtml);',
  '  doc = fill(doc, \'__CSS__\', CSS_BLOCKS);',
  '  doc = fill(doc, \'__SECTION__\', html);',
  '  doc = fill(doc, \'__SCRIPT__\', script);',
  '  return doc;',
  '}',
  '',
  '/* ---- control bar state and repainting */',
  'var state = {',
  '  colors: {',
  '    primary: PAYLOAD.palettePresets[0].primary,',
  '    secondary: PAYLOAD.palettePresets[0].secondary,',
  '    tertiary: PAYLOAD.palettePresets[0].tertiary,',
  '    neutral: PAYLOAD.palettePresets[0].neutral,',
  '  },',
  '  font: PAYLOAD.fontPresets[0],',
  '};',
  'function paletteVars() {',
  '  var c = state.colors;',
  '  return {',
  '    primary: c.primary, secondary: c.secondary, tertiary: c.tertiary, neutral: c.neutral,',
  '    \'n-ink\': contrastInk(c.neutral), \'p-ink\': contrastInk(c.primary), \'t-ink\': contrastInk(c.tertiary),',
  '    \'p-on-n\': readableOn(c.primary, c.neutral), \'t-on-n\': readableOn(c.tertiary, c.neutral),',
  '    \'t-on-p\': readableOn(c.tertiary, c.primary), \'p-on-p\': readableOn(c.primary, c.primary),',
  '    \'t-on-t\': readableOn(c.tertiary, c.tertiary), \'p-on-i\': readableOn(c.primary, contrastInkHex(c.primary)),',
  '  };',
  '}',
  'function applyToFrame(iframe) {',
  '  var win = iframe.contentWindow;',
  '  if (!win || !win.__applyPalette) return;',
  '  win.__applyPalette(paletteVars());',
  '  win.__applyFonts({',
  '    heading: fontStack(state.font.heading.family),',
  '    body: fontStack(state.font.body.family),',
  '    headingWeight: String(state.font.heading.weight),',
  '  });',
  '}',
  'function applyAll() {',
  '  Array.prototype.forEach.call(document.querySelectorAll(\'iframe[data-cell]\'), applyToFrame);',
  '}',
  '',
  '/* ---- wire the frames */',
  'var cellById = {};',
  'PAYLOAD.cells.forEach(function (cell) { cellById[cell.id] = cell; });',
  'Array.prototype.forEach.call(document.querySelectorAll(\'iframe[data-cell]\'), function (iframe) {',
  '  var cell = cellById[iframe.getAttribute(\'data-cell\')];',
  '  iframe.addEventListener(\'load\', function () { applyToFrame(iframe); });',
  '  iframe.srcdoc = buildDoc(cell);',
  '  if (cell.section === \'motion\') {',
  '    iframe.closest(\'.cell\').addEventListener(\'mouseenter\', function () {',
  '      try { if (iframe.contentWindow.__replayMotion) iframe.contentWindow.__replayMotion(); } catch (e) {}',
  '    });',
  '  }',
  '});',
  '',
  '/* ---- control bar events */',
  'function markActive(groupSelector, active) {',
  '  Array.prototype.forEach.call(document.querySelectorAll(groupSelector), function (button) {',
  '    if (button === active) button.setAttribute(\'data-active\', \'\');',
  '    else button.removeAttribute(\'data-active\');',
  '  });',
  '}',
  'Array.prototype.forEach.call(document.querySelectorAll(\'[data-palette-preset]\'), function (button) {',
  '  button.addEventListener(\'click\', function () {',
  '    var preset = PAYLOAD.palettePresets[Number(button.getAttribute(\'data-palette-preset\'))];',
  '    state.colors = { primary: preset.primary, secondary: preset.secondary, tertiary: preset.tertiary, neutral: preset.neutral };',
  '    Array.prototype.forEach.call(document.querySelectorAll(\'input[data-role]\'), function (input) {',
  '      input.value = state.colors[input.getAttribute(\'data-role\')];',
  '    });',
  '    markActive(\'[data-palette-preset]\', button);',
  '    applyAll();',
  '  });',
  '});',
  'Array.prototype.forEach.call(document.querySelectorAll(\'input[data-role]\'), function (input) {',
  '  input.value = state.colors[input.getAttribute(\'data-role\')];',
  '  input.addEventListener(\'input\', function () {',
  '    state.colors[input.getAttribute(\'data-role\')] = input.value.toUpperCase();',
  '    markActive(\'[data-palette-preset]\', null);',
  '    applyAll();',
  '  });',
  '});',
  'Array.prototype.forEach.call(document.querySelectorAll(\'[data-font-preset]\'), function (button) {',
  '  button.addEventListener(\'click\', function () {',
  '    state.font = PAYLOAD.fontPresets[Number(button.getAttribute(\'data-font-preset\'))];',
  '    markActive(\'[data-font-preset]\', button);',
  '    applyAll();',
  '  });',
  '});',
  '',
  '/* ---- uniform downscaling: a cell shrinks as one image when its column is narrower than its captured stage */',
  'function fitScaler(scaler) {',
  '  var w = parseFloat(scaler.getAttribute(\'data-width\'));',
  '  var h = parseFloat(scaler.getAttribute(\'data-height\'));',
  '  var scale = Math.min(1, scaler.clientWidth / w);',
  '  scaler.firstElementChild.style.transform = \'scale(\' + scale + \')\';',
  '  scaler.style.height = (h * scale) + \'px\';',
  '}',
  'var scalerObserver = new ResizeObserver(function (entries) {',
  '  entries.forEach(function (entry) { fitScaler(entry.target); });',
  '});',
  'Array.prototype.forEach.call(document.querySelectorAll(\'.scaler\'), function (scaler) {',
  '  fitScaler(scaler);',
  '  scalerObserver.observe(scaler);',
  '});',
].join('\n');

const HOST_CSS = [
  ':root { color-scheme: dark; }',
  'body { margin: 0; padding: 0 40px 64px; background: oklch(0.07 0.006 95); color: #cfc9ba;',
  '  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }',
  'h1 { font-size: 18px; font-weight: 600; margin: 24px 0 6px; color: #efe9da; }',
  'p.note { margin: 0 0 20px; opacity: .7; }',
  'h2 { font-size: 15px; font-weight: 600; margin: 44px 0 14px; color: #efe9da; }',
  '.controls { position: sticky; top: 0; z-index: 10; background: #1a1712; border-bottom: 1px solid #363025;',
  '  padding: 12px 40px; margin: 0 -40px 12px; display: flex; flex-direction: column; gap: 8px; }',
  '.controls .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }',
  '.controls .lbl { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; opacity: .6; width: 70px; flex: none; }',
  '.controls button { background: #2a251c; color: #efe9da; border: 1px solid #4a4232; padding: 6px 10px;',
  '  cursor: pointer; font: inherit; font-size: 13px; }',
  '.controls button[data-active] { border-color: #c8b57c; }',
  '.controls .sw { display: inline-block; width: 11px; height: 11px; margin-right: 2px; vertical-align: -1px; }',
  '.controls label { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; opacity: .85; }',
  '.controls input[type="color"] { width: 30px; height: 22px; padding: 0; border: 1px solid #4a4232; background: none; }',
  '.controls a { color: #c8b57c; text-decoration: none; font-size: 13px; margin-right: 8px; }',
  '.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(var(--cell-min, 560px), 100%), 1fr));',
  '  gap: 36px 28px; }',
  'figure.cell { margin: 0; min-width: 0; }',
  'figure.cell figcaption { margin: 0 0 8px; font-size: 13px; letter-spacing: .02em; opacity: .85; }',
  'figure.cell .scaler { position: relative; width: 100%; }',
  'figure.cell .clip { overflow: hidden; position: absolute; top: 0; left: 0; transform-origin: top left; }',
  'figure.cell iframe { display: block; border: 0; background: transparent; position: absolute; top: 0; left: 0; }',
].join('\n');

async function main() {
  const capture = JSON.parse(await readFile(OUT_DIR + '/capture.json', 'utf8'));

  /* Guard: everything the cells need must be in the capture, and no network
     URL may survive in the CSS. */
  for (const section of SECTIONS) {
    const got = capture.sections[section.id];
    if (!got) throw new Error('capture.json is missing section ' + section.id);
    if (!got.dims) throw new Error('capture.json is missing dims for ' + section.id);
    if (section.id === 'palette' || section.id === 'icons') {
      if (!got.variants || Object.keys(got.variants).length !== section.cells.length) {
        throw new Error('capture.json has incomplete variants for ' + section.id);
      }
    } else if (!got.sectionHtml) {
      throw new Error('capture.json is missing sectionHtml for ' + section.id);
    }
  }
  if (!capture.cssSources || capture.cssSources.length === 0) throw new Error('capture.json has no cssSources');
  for (const source of capture.cssSources) {
    if (/url\((['"]?)https?:/.test(source.text)) {
      throw new Error('a network url() survived in stylesheet ' + source.from + '; re-run the capture');
    }
  }

  /* Neutralize captured <img> tags so no cell fetches anything. */
  const sections = {};
  for (const [id, section] of Object.entries(capture.sections)) {
    sections[id] = {
      screen: section.screen,
      stageSelector: section.stageSelector,
      dims: section.dims,
      sectionHtml: section.sectionHtml ? neutralizeImages(section.sectionHtml) : undefined,
      variants: section.variants
        ? Object.fromEntries(Object.entries(section.variants).map(([k, v]) => [k, neutralizeImages(v)]))
        : undefined,
    };
  }

  const cells = CELL_LIST.map((cell) => ({ ...cell, externalHtml: externalInputs(cell) }));

  const payload = {
    viewport: capture.viewport,
    foilDataUri: capture.foilDataUri,
    cssSources: capture.cssSources,
    sections,
    cells,
    palettePresets: PALETTE_PRESETS,
    fontPresets: FONT_PRESETS,
    iframeTemplate: IFRAME_TEMPLATE,
    iframeScript: IFRAME_SCRIPT,
  };
  /* All '<' inside the JSON become \u003c so the payload can sit inside a
     script tag with no risk of a premature close tag. */
  const payloadJson = JSON.stringify(payload).replace(/</g, '\\u003c');

  const swatches = (preset) =>
    ['primary', 'secondary', 'tertiary', 'neutral']
      .map((role) => '<span class="sw" style="background:' + preset[role] + '"></span>')
      .join('');

  const controls = [
    '<div class="controls">',
    '<div class="row"><span class="lbl">Palette</span>',
    ...PALETTE_PRESETS.map((preset, index) =>
      '<button type="button" data-palette-preset="' + index + '"' + (index === 0 ? ' data-active' : '') + '>'
      + swatches(preset) + ' ' + (index + 1) + ' &middot; ' + preset.id + '</button>'),
    ...['primary', 'secondary', 'tertiary', 'neutral'].map((role) =>
      '<label>' + role.charAt(0).toUpperCase() + role.slice(1)
      + ' <input type="color" data-role="' + role + '"></label>'),
    '</div>',
    '<div class="row"><span class="lbl">Fonts</span>',
    ...FONT_PRESETS.map((preset, index) =>
      '<button type="button" data-font-preset="' + index + '"' + (index === 0 ? ' data-active' : '') + '>'
      + (index + 1) + ' &middot; ' + preset.name + '</button>'),
    '</div>',
    '<div class="row"><span class="lbl">Jump to</span>',
    ...SECTIONS.map((section) => '<a href="#section-' + section.id + '">' + section.title.replace(/ \(screen .*\)/, '') + '</a>'),
    '</div>',
    '</div>',
  ].join('\n');

  const sectionsHtml = SECTIONS.map((section) => {
    const dims = capture.sections[section.id].dims;
    const cellsHtml = cells.filter((cell) => cell.section === section.id).map((cell) => [
      '<figure class="cell">',
      '<figcaption>' + cell.caption + '</figcaption>',
      '<div class="scaler" data-width="' + dims.width + '" data-height="' + dims.height + '">',
      '<div class="clip" style="width:' + dims.width + 'px;height:' + dims.height + 'px">',
      '<iframe title="' + cell.caption.replace(/"/g, '&quot;') + '" data-cell="' + cell.id
        + '" data-section="' + cell.section + '" scrolling="no" style="width:'
        + capture.viewport.width + 'px;height:' + capture.viewport.height + 'px"></iframe>',
      '</div>',
      '</div>',
      '</figure>',
    ].join('\n')).join('\n');
    return '<section id="section-' + section.id + '">\n<h2>' + section.title + '</h2>\n<div class="grid" style="--cell-min:' + Math.ceil(dims.width) + 'px">\n'
      + cellsHtml + '\n</div>\n</section>';
  }).join('\n');

  const html = [
    '<!doctype html>',
    '<!-- impeccable-disable design-system-font, overused-font, single-font, flat-type-hierarchy, design-system-color, design-system-font-size, design-system-radius, side-tab, marquee, repeating-stripes-gradient -- standalone extraction fixture: verbatim ground-truth copy of the questionnaire previews (live-captured markup + built CSS); the host shell is minimal chrome around 86 iframes. Generated by tmp/questionaire/build-gallery.mjs; do not hand-edit. -->',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<title>Questionnaire previews, ground-truth gallery</title>',
    '<style>',
    HOST_CSS,
    '</style>',
    '</head>',
    '<body>',
    '<h1>Questionnaire previews</h1>',
    '<p class="note">Ground-truth extraction of every questionnaire preview except type scale and iconography: 75 cells, one per valid surface and option combination. The control bar repaints every cell through the picker\'s own custom-property machinery; hover a Motion cell to restart its scene from the first frame.</p>',
    controls,
    sectionsHtml,
    '<script type="application/json" id="gallery-payload">',
    payloadJson,
    '<\/script>',
    '<script>',
    HOST_RUNTIME,
    '<\/script>',
    '</body>',
    '</html>',
  ].join('\n');

  await writeFile(OUT_DIR + '/previews-gallery.html', html);
  console.log('wrote previews-gallery.html (' + (html.length / 1024 / 1024).toFixed(1) + ' MB, ' + cells.length + ' cells)');
}

main().catch((error) => { console.error(error); process.exit(1); });