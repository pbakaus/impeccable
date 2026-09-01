/**
 * Hero-gate checks that name a miss as a number the model can act on.
 *
 * comp-diff scores regions; these read what a designer reads when the two
 * frames sit side by side and says it as numbers: the headline is set at
 * cap 78px where the comp's is 103; it wraps to four lines where the comp
 * has three; its ink is #2a2a2a where the comp's is #a72f1b; it starts
 * 60px lower in its box; the masthead is 92px tall where the comp's is 58;
 * these grid cells carry ink the comp does not have (a kicker, a divider, a
 * second nav row). Every one of those was a pin in the first human review
 * of the third sweep, on builds the region scores had already let through.
 *
 * All functions are pure over decoded rasters and the spec; the gate wires
 * them and decides what vetoes.
 */
import { fingerprint } from './font-fingerprint.mjs';
import { crop } from './raster.mjs';
import { dominantColors, deltaE, detailGrid } from './image-metrics.mjs';
import { inkBox } from '../comp-diff.mjs';

/** Dominant ink colour of a crop: the heaviest cluster that is not the ground. */
export function inkColor(img) {
  const cols = dominantColors(img, 4);
  if (!cols.length) return null;
  const ground = cols[0];
  const ink = cols.find((c) => c !== ground && deltaE(c.lab, ground.lab) > 20) || null;
  return { ground, ink };
}

/**
 * Compare one text region's build crop against the comp's measurement.
 * `region` is a spec region with `type.comp` (font-match --measure) and
 * `px`; `compCrop` / `buildCrop` are the region crops at comp scale.
 * Returns { findings: string[], metrics }.
 */
export function textRegionCheck(region, compCrop, buildCrop, { capTol = 0.22, minCap = 10 } = {}) {
  const findings = [];
  // Measure the comp crop now rather than trusting spec.type.comp: the spec
  // may carry an older fingerprint's reading, and this check has to agree
  // with itself on both sides.
  const comp = fingerprint(compCrop);
  // colour reads on any text region, measured or not: a spine set vertical
  // (unmeasurable) came back white on red where the comp had black on red
  // in five builds
  const colourOnly = () => {
    const ca = inkColor(compCrop), cb = inkColor(buildCrop);
    if (ca && cb && ca.ink && cb.ink && deltaE(ca.ink.lab, cb.ink.lab) > 22) findings.push(`text ${region.id}: ink is ${cb.ink.hex} in the build, ${ca.ink.hex} in the comp; use the comp's colour`);
    return { findings, metrics: null };
  };
  if (!comp || !comp.capHeightPx || comp.capHeightPx < minCap || comp.glyphs < 6) return colourOnly();
  // rotated type (a spine set vertical) reads as many short 'lines' of one
  // or two glyphs; the fingerprint has nothing to say about it
  if (comp.lines >= 5 && comp.glyphs / comp.lines < 3) return colourOnly();
  // a cap taller than half the box is a drawing read as a glyph, not type
  if (comp.capHeightPx > compCrop.height * 0.6) return colourOnly();
  const bfp = fingerprint(buildCrop);
  const metrics = { comp: { cap: comp.capHeightPx, lines: comp.lines, glyphs: comp.glyphs }, build: bfp ? { cap: bfp.capHeightPx, lines: bfp.lines, glyphs: bfp.glyphs } : null };
  if (!bfp || bfp.glyphs < 4) {
    // nothing legible in the box: comp-diff's missing/contradicted covers it
    return { findings, metrics };
  }
  const capDelta = (bfp.capHeightPx - comp.capHeightPx) / comp.capHeightPx;
  if (Math.abs(capDelta) > capTol) {
    findings.push(`text ${region.id}: cap height ${bfp.capHeightPx}px in the build, ${comp.capHeightPx}px in the comp (${capDelta > 0 ? '+' : ''}${Math.round(capDelta * 100)}%); set font-size so the cap height renders at ${comp.capHeightPx}px${region.type.chosen ? ` (font-match ranked ${region.type.chosen.family} ${region.type.chosen.weight} at ${region.type.chosen.fontSizePx}px)` : ''}`);
  }
  if (comp.lines >= 2 && bfp.lines !== comp.lines && Math.abs(bfp.lines - comp.lines) >= 1) {
    findings.push(`text ${region.id}: ${bfp.lines} line${bfp.lines === 1 ? '' : 's'} in the build, ${comp.lines} in the comp; the measure (max-width, font-size, letter-spacing) wraps it differently, so the block is a different shape`);
  } else if (comp.lines >= 3 && bfp.lines === comp.lines && Math.abs(capDelta) <= capTol) {
    // same lines at the same size: the leading is the remaining shape
    const ba0 = inkBox(compCrop), bb0 = inkBox(buildCrop);
    if (ba0 && bb0) {
      const pa = ba0.h / comp.lines, pb = bb0.h / bfp.lines;
      const dp = (pb - pa) / pa;
      if (Math.abs(dp) > 0.2) findings.push(`text ${region.id}: line pitch ${Math.round(pb)}px in the build, ${Math.round(pa)}px in the comp (${dp > 0 ? '+' : ''}${Math.round(dp * 100)}%); set line-height so ${comp.lines} lines stand ${Math.round(ba0.h)}px tall`);
    }
  }
  // tracking: the gap between glyphs in cap units, when both sides read it
  if (comp.gap != null && bfp.gap != null && Math.abs(capDelta) <= capTol && comp.glyphs >= 8 && bfp.glyphs >= 8) {
    const dg = bfp.gap - comp.gap;
    if (Math.abs(dg) > Math.max(0.03, comp.gap * 0.5)) findings.push(`text ${region.id}: letter-spacing is ${dg > 0 ? 'wider' : 'tighter'} than the comp's (gap ${bfp.gap.toFixed(3)} vs ${comp.gap.toFixed(3)} of the cap height); set letter-spacing to ${dg > 0 ? 'close' : 'open'} it by about ${Math.abs(Math.round(dg * comp.capHeightPx))}px`);
  }
  // weight: compare ink density of tall glyphs when both sides have it and
  // the sizes agree (density at a different cap is a different reading)
  if (comp.densTall != null && bfp.densTall != null && Math.abs(capDelta) <= capTol) {
    const r = bfp.densTall / comp.densTall;
    if (r > 1.25) findings.push(`text ${region.id}: the face renders ${Math.round((r - 1) * 100)}% heavier than the comp's (ink density ${bfp.densTall.toFixed(2)} vs ${comp.densTall.toFixed(2)}); drop a weight step or use the ranked face`);
    else if (r < 0.75) findings.push(`text ${region.id}: the face renders ${Math.round((1 - r) * 100)}% lighter than the comp's (ink density ${bfp.densTall.toFixed(2)} vs ${comp.densTall.toFixed(2)}); raise a weight step or use the ranked face`);
  }
  // colour: dominant ink of each crop. Small type on a ruled or grainy
  // ground (a track row across staff lines at cap 14) has no reliable ink
  // cluster; the reading fired both ways on neighbouring rows of one list.
  if (comp.capHeightPx >= 16) {
    const ca = inkColor(compCrop), cb = inkColor(buildCrop);
    if (ca && cb && ca.ink && cb.ink) {
      const d = deltaE(ca.ink.lab, cb.ink.lab);
      if (d > 22) findings.push(`text ${region.id}: ink is ${cb.ink.hex} in the build, ${ca.ink.hex} in the comp; use the comp's colour`);
    }
  }
  // vertical placement inside the box: top of ink
  const ba = inkBox(compCrop), bb = inkBox(buildCrop);
  if (ba && bb) {
    const dy = bb.y - ba.y;
    if (Math.abs(dy) > Math.max(12, compCrop.height * 0.15)) findings.push(`text ${region.id}: its first line starts ${Math.abs(Math.round(dy))}px ${dy > 0 ? 'lower' : 'higher'} than in the comp (${bb.y}px vs ${ba.y}px into the region box); the spacing above it is ${dy > 0 ? 'too large' : 'too small'}`);
    const dx = bb.x - ba.x;
    if (Math.abs(dx) > Math.max(12, compCrop.width * 0.15)) findings.push(`text ${region.id}: it starts ${Math.abs(Math.round(dx))}px ${dx > 0 ? 'further right' : 'further left'} than in the comp`);
  }
  metrics.capDelta = +capDelta.toFixed(3);
  return { findings, metrics };
}

/**
 * Rows of a crop that carry a horizontal rule: a row whose gray step from
 * the row above (or below) is strong across at least `span` of the width.
 * Returns row indices sorted top to bottom.
 */
export function ruleRows(img, { span = 0.5, step = 28 } = {}) {
  const W = img.width, H = img.height;
  const gray = (x, y) => { const i = (y * W + x) * 4; return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]; };
  const rows = [];
  for (let y = 1; y < H - 1; y++) {
    let strong = 0;
    for (let x = 0; x < W; x++) { const d = Math.max(Math.abs(gray(x, y) - gray(x, y - 1)), Math.abs(gray(x, y) - gray(x, y + 1))); if (d > step) strong++; }
    if (strong >= W * span) rows.push(y);
  }
  // collapse adjacent rows into one edge
  const out = [];
  for (const y of rows) if (!out.length || y - out[out.length - 1] > 3) out.push(y);
  return out;
}

/**
 * A thin chrome region (masthead, nav bar, footer strip) has a height, and
 * its height is where its rule sits. Compare the first horizontal rule's row
 * in comp vs build; fall back to the ink extents when neither has a rule.
 */
export function chromeStripCheck(region, compCrop, buildCrop) {
  const findings = [];
  const strip = compCrop.height <= compCrop.width * 0.35;
  if (!strip) return { findings };
  // a control that is one link or one button, not a bar across its box, has
  // no strip height to compare (its underline read as a 'rule' for 27
  // attempts in one session)
  if (region.kind === 'control') {
    const ib = inkBox(compCrop);
    if (!ib || ib.w < compCrop.width * 0.6) return { findings };
  }
  const ra = ruleRows(compCrop), rb = ruleRows(buildCrop);
  if (ra.length && rb.length) {
    // the rule that closes the strip is the first one from the top (a grid
    // row often carries the next element's top edge lower down)
    const ya = ra[0], yb = rb[0];
    const dy = yb - ya;
    if (Math.abs(dy) > Math.max(5, compCrop.height * 0.06)) findings.push(`${region.kind} ${region.id}: its rule sits ${ya}px into the box in the comp and ${yb}px in the build (${dy > 0 ? '+' : ''}${dy}px), so the strip is ${dy > 0 ? 'taller' : 'shorter'} than the comp's; match the height, not only the position`);
    return { findings, comp: ya, build: yb };
  }
  const ba = inkBox(compCrop), bb = inkBox(buildCrop);
  if (!ba || !bb) return { findings };
  if (ba.w >= compCrop.width * 0.6 && ba.h <= compCrop.height * 0.6) {
    const dh = bb.h - ba.h;
    if (Math.abs(dh) > Math.max(10, ba.h * 0.25)) findings.push(`${region.kind} ${region.id}: its ink is ${bb.h}px tall in the build and ${ba.h}px in the comp (${dh > 0 ? '+' : ''}${dh}px); match the height, not only the position`);
  }
  return { findings, comp: ba, build: bb };
}

/**
 * Cells of the frame where the build carries ink and the comp is calm.
 * Returns { cells: [{col,row,label}], fraction } on a cols x rows grid.
 * `floor` is the comp energy under which a cell counts as calm; `added` is
 * the build energy over which the build counts as inked.
 */
export function inventedInk(comp, build, { cols = 10, rows = 10, floor = 10, added = 12, ratio = 2.5 } = {}) {
  const a = detailGrid(comp, cols, rows, 512), b = detailGrid(build, cols, rows, 512);
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    // calm in the comp (grain, flat ground) and inked in the build well past
    // what grain would give: a kicker over paper, a divider, a nav row
    if (!(a.cells[i] < floor && b.cells[i] > Math.max(added, a.cells[i] * ratio))) continue;
    // the comp must be calm around the cell too: a hard edge one pixel over
    // the cell boundary in the build (a bar shifted by a subpixel of the
    // alignment) reads as invented otherwise
    let neighbourhood = 0, n = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue; neighbourhood += a.cells[rr * cols + cc]; n++; }
    if (neighbourhood / n >= floor * 2) continue;
    cells.push({ col: c, row: r, label: `${String.fromCharCode(65 + c)}${r}`, comp: +a.cells[i].toFixed(1), build: +b.cells[i].toFixed(1) });
  }
  return { cells, fraction: cells.length / (cols * rows) };
}

/**
 * A plate cropped by its box: the comp's artwork keeps a margin inside the
 * region on some side and the build's ink runs flush to that edge (object-fit:
 * cover on a box smaller than the artwork's aspect, or an <img> sized to the
 * column). The best build of the fifth sweep passed the hero at 87% with the
 * cover arch cut off at the left and bottom; the human review called it a
 * bug in one word. Returns the sides clipped, or [].
 */
export function plateClipCheck(region, compCrop, buildCrop, { margin = 6 } = {}) {
  const a = inkBox(compCrop), b = inkBox(buildCrop);
  if (!a || !b) return { sides: [] };
  const W = compCrop.width, H = compCrop.height;
  const sides = [];
  const flush = (v) => v <= 1;
  if (a.x >= margin && flush(b.x)) sides.push('left');
  if (a.y >= margin && flush(b.y)) sides.push('top');
  if (W - (a.x + a.w) >= margin && flush(W - (b.x + b.w))) sides.push('right');
  if (H - (a.y + a.h) >= margin && flush(H - (b.y + b.h))) sides.push('bottom');
  return { sides, comp: a, build: b };
}

/**
 * Inline SVG that is an illustration, not an icon. An icon is small (a
 * viewBox or box under `iconPx` on its long side) with a few paths; anything
 * with a real path budget is a drawing in code: a diagram, a rack of
 * carburetors, staff notation, leader lines with arrows, a "terrible svg
 * approximation of the asset". Those ship as plates or as part of the plate
 * they annotate. Returns one entry per offending <svg> with a snippet.
 *
 * `html` is the artifact source. `pathBudget` counts characters of path
 * data (d="..."), points, and polyline/polygon points across the element.
 */
export function svgIllustrations(html, { iconPx = 64, pathBudget = 480, maxPaths = 8 } = {}) {
  const out = [];
  const re = /<svg\b([^>]*)>([\s\S]*?)<\/svg>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1], body = m[2];
    const paths = (body.match(/<path\b/gi) || []).length + (body.match(/<(polyline|polygon|line|circle|ellipse|rect)\b/gi) || []).length;
    let budget = 0;
    for (const d of body.matchAll(/\sd="([^"]*)"/g)) budget += d[1].length;
    for (const pts of body.matchAll(/\spoints="([^"]*)"/g)) budget += pts[1].length;
    const vb = /viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/.exec(attrs);
    const w = /\swidth="([\d.]+)(px)?"/.exec(attrs), h = /\sheight="([\d.]+)(px)?"/.exec(attrs);
    const long = Math.max(vb ? Math.max(+vb[1], +vb[2]) : 0, w ? +w[1] : 0, h ? +h[1] : 0);
    const iconSized = long > 0 && long <= iconPx && paths <= maxPaths;
    const uses = /<use\b/i.test(body) && paths === 0; // a sprite reference
    if (uses) continue;
    if (iconSized && budget <= pathBudget) continue;
    if (budget <= pathBudget && paths <= maxPaths && long === 0 && !/<(text|image)\b/i.test(body)) continue; // a tiny inline glyph with no size hint
    if (budget > pathBudget || paths > maxPaths || (long > iconPx && paths > 0)) {
      const id = /\b(id|class|aria-label|data-region)="([^"]+)"/i.exec(attrs);
      out.push({ snippet: `<svg${attrs.slice(0, 80).replace(/\s+/g, ' ')}...> (${paths} shapes, ${budget} chars of path data${long ? `, ${long}px` : ''})`, label: id ? id[2] : null, paths, budget, long });
    }
  }
  return out;
}
