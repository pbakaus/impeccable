#!/usr/bin/env node
// visual-cues.mjs — crop + compile for document seed visual cues.
// Pipeline doc: skill/reference/visual-cues.md (canonical; this help text is not).
//
// Each cue is a full-bleed hero scene plus an artifact sheet (four objects,
// one per quadrant) rendered twice: on cream and on black. `matte` fuses
// the two passes into one transparent-background RGBA sheet; `crop` cuts
// any sheet into per-artifact PNGs, preserving whatever alpha it carries.
//
//   node visual-cues.mjs crop <hero.png> <artifacts.png> --slug <two-word-slug>
//       [--palette "primary=#RRGGBB;secondary=...;tertiary=...;neutral=..."]
//       [--out <dir>]   (default: .impeccable/visual-cues)
//     Copies the hero untouched to <slug>.png, keeps the sheet it was
//     given under <out>/masters/<slug>-artifacts.png, quadrant-crops the
//     sheet into <slug>-2..5.png (alpha preserved), finds each planned
//     palette hex's closest pixel in the hero, and updates <out>/cues.json.
//     Both inputs must be square: generation happens on a square canvas
//     (a size/aspect parameter, not just a prompt line), and a non-square
//     input is a generation to redo, not an image to fix up here.
//
//   node visual-cues.mjs matte <light.png> <dark.png> --out <final.png>
//     Difference matting: the same artifact sheet rendered twice, once on
//     the cream backing and once on pure black, fuses into one RGBA PNG
//     with a computed alpha channel. For image models that can't emit
//     alpha natively (prompting for "transparent" gets a painted
//     checkerboard; chroma keys spill). Prints coverage stats so the
//     caller can tell a failed matte (background never changed between
//     passes / objects moved between passes).
//
// Dependency-free: PNG decode/encode on node:zlib. Rejects interlaced and
// indexed-color PNGs; convert those with sips/ImageMagick/PIL first.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

// ---------------------------------------------------------------- PNG codec

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Every PNG chunk carries a CRC-32 trailer (the spec's fixed polynomial,
// 0xedb88320); precompute the 256-entry lookup table once instead of doing
// the bit-by-bit division per byte.
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// PNG filter type 4 (Paeth): predicts a byte from its left (a), above (b),
// and above-left (c) neighbors, picking whichever of a, b, or a+b-c lands
// closest to the actual gradient. Used only by decodePng's unfilter step;
// encodePng always writes filter 0, so it never needs the inverse.
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('not a PNG file');
  // Walk the chunk stream: each chunk is [4-byte length][4-byte type][data][4-byte crc].
  // IHDR carries the header fields; IDAT is the (possibly multi-chunk)
  // compressed pixel data, concatenated below before inflating; other
  // chunk types (tEXt, iCCP, etc.) are skipped since nothing here needs them.
  let pos = 8;
  let ihdr = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len; // length + type + data + crc
  }
  if (!ihdr) throw new Error('PNG has no IHDR chunk');
  const { width, height, bitDepth, colorType, interlace } = ihdr;
  if (interlace) throw new Error('interlaced PNG not supported; re-save without interlacing (sips, ImageMagick, or PIL)');
  if (colorType === 3) throw new Error('indexed-color PNG not supported; convert to RGB/RGBA first (sips, ImageMagick, or PIL)');
  if (bitDepth !== 8 && bitDepth !== 16) throw new Error(`unsupported bit depth ${bitDepth}; convert to 8-bit first`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported color type ${colorType}`);

  const sampleBytes = bitDepth / 8;
  const bpp = channels * sampleBytes; // bytes per pixel
  const stride = width * bpp; // bytes per scanline, excluding the filter-type byte
  const raw = zlib.inflateSync(Buffer.concat(idat));

  // Each scanline in the inflated stream is prefixed with a 1-byte filter
  // type (0-4) that says how it was delta-encoded against the row above
  // and/or the pixel to the left; undo that in place, row by row, since
  // filter 2-4 need the already-unfiltered previous row to reconstruct.
  const px = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const row = px.subarray(y * stride, (y + 1) * stride);
    raw.copy(row, 0, rp, rp + stride);
    rp += stride;
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    if (filter === 0) continue; // None: bytes are already the real pixel values
    if (filter === 1) {
      // Sub: each byte was stored as (value - left).
      for (let i = bpp; i < stride; i++) row[i] = (row[i] + row[i - bpp]) & 0xff;
    } else if (filter === 2) {
      // Up: each byte was stored as (value - above).
      if (prev) for (let i = 0; i < stride; i++) row[i] = (row[i] + prev[i]) & 0xff;
    } else if (filter === 3) {
      // Average: each byte was stored as (value - floor((left + above) / 2)).
      for (let i = 0; i < stride; i++) {
        const left = i >= bpp ? row[i - bpp] : 0;
        const up = prev ? prev[i] : 0;
        row[i] = (row[i] + ((left + up) >> 1)) & 0xff;
      }
    } else if (filter === 4) {
      // Paeth: each byte was stored as (value - paeth(left, above, above-left)).
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = prev ? prev[i] : 0;
        const c = prev && i >= bpp ? prev[i - bpp] : 0;
        row[i] = (row[i] + paeth(a, b, c)) & 0xff;
      }
    } else {
      throw new Error(`unknown PNG filter ${filter} at row ${y}`);
    }
  }

  // Normalize every supported color type (grayscale, RGB, grayscale+alpha,
  // RGBA) down to one consistent RGBA8 buffer, so everything past this
  // point (crop, palette search, re-encode) only ever deals with one shape.
  // 16-bit samples keep only the high byte; visual cues never need more
  // than 8 bits of precision per channel.
  const rgba = Buffer.alloc(width * height * 4);
  const at = (base, ch) => px[base + ch * sampleBytes];
  for (let i = 0; i < width * height; i++) {
    const base = i * bpp;
    let r, g, b, a;
    if (colorType === 0) {
      r = g = b = at(base, 0);
      a = 255;
    } else if (colorType === 2) {
      r = at(base, 0); g = at(base, 1); b = at(base, 2);
      a = 255;
    } else if (colorType === 4) {
      r = g = b = at(base, 0);
      a = at(base, 1);
    } else {
      r = at(base, 0); g = at(base, 1); b = at(base, 2); a = at(base, 3);
    }
    const o = i * 4;
    rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
  }
  return { width, height, rgba, hasAlpha: colorType === 4 || colorType === 6 };
}

// Wraps one chunk's payload with its length header, type tag, and CRC
// trailer, matching the layout decodePng's chunk walk expects.
function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

// Always writes 8-bit RGBA with filter type 0 (None) on every scanline: the
// crops here are small and this script has no bandwidth concerns, so the
// simplicity of never predicting/unpredicting bytes outweighs the larger
// file size a real filter choice would save.
export function encodePng(rgba, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type 6 = RGBA
  const stride = width * 4;
  // One extra byte per row for the filter-type prefix (always 0 here).
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([PNG_SIG, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

// ------------------------------------------------------------ quadrant math

// The artifact sheet is one 2x2 grid on a flat cream canvas, one object per
// quadrant, in reading order: q2 top-left, q3 top-right, q4 bottom-left,
// q5 bottom-right. Proportional, so any square-ish sheet cuts the same way.
export function quadrants(width, height) {
  const mx = Math.round(width / 2);
  const my = Math.round(height / 2);
  return {
    q2: { x: 0, y: 0, w: mx, h: my },
    q3: { x: mx, y: 0, w: width - mx, h: my },
    q4: { x: 0, y: my, w: mx, h: height - my },
    q5: { x: mx, y: my, w: width - mx, h: height - my },
  };
}

// Copies one rectangle r = {x, y, w, h} out of img.rgba, row by row (rows
// aren't contiguous across the crop boundary in the source buffer).
function cropRegion(img, r) {
  const out = Buffer.alloc(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    const src = ((r.y + y) * img.width + r.x) * 4;
    img.rgba.copy(out, y * r.w * 4, src, src + r.w * 4);
  }
  return out;
}

// The pipeline ships squares, and squaring after the fact always loses
// something (cropping eats scene, padding invents background), so square
// is required at the source: the generation call must pin a 1:1 canvas.
// A non-square input here means that call must be redone.
function requireSquare(img, label) {
  if (img.width !== img.height) {
    throw new Error(`${label} is ${img.width}x${img.height}, not square; regenerate it with the tool's square (1:1) size/aspect parameter, a prompt line alone does not pin the canvas`);
  }
}

// ----------------------------------------------------------------- palette

// role=#RRGGBB per entry; a legacy trailing @x,y is accepted and ignored
// (the search below beats model-reported coordinates every time).
const PALETTE_ENTRY = /^([a-z][a-z-]*)=(#[0-9a-fA-F]{6})(?:@\d+,\d+)?$/;

function parsePalette(str) {
  const out = {};
  for (const part of str.split(';')) {
    const m = part.trim().match(PALETTE_ENTRY);
    if (!m) throw new Error(`bad palette entry "${part.trim()}" (expected role=#RRGGBB)`);
    out[m[1]] = { hex: m[2].toUpperCase() };
  }
  return out;
}

// The parent designed the palette, so the planned hex is known; what needs
// measuring is where and how faithfully the hero staged it. Search the whole
// hero for the pixel closest to each planned hex. hex stays the planned
// value; snapped is the closest rendered pixel; at is its hero position.
function snapPalette(img, palette) {
  const out = {};
  // Sample on a grid instead of every pixel: ~150 samples per axis is dense
  // enough to find a representative patch of any staged color, and scanning
  // a 1500x1500 hero at full resolution for every role adds up otherwise.
  const step = Math.max(1, Math.floor(Math.min(img.width, img.height) / 150));
  for (const [role, entry] of Object.entries(palette)) {
    const pr = parseInt(entry.hex.slice(1, 3), 16);
    const pg = parseInt(entry.hex.slice(3, 5), 16);
    const pb = parseInt(entry.hex.slice(5, 7), 16);
    let best = Infinity;
    let bx = 0;
    let by = 0;
    // Squared Euclidean distance in RGB space; skipping the sqrt is fine
    // since only the relative ordering of distances matters here.
    for (let y = 0; y < img.height; y += step) {
      for (let x = 0; x < img.width; x += step) {
        const o = (y * img.width + x) * 4;
        const dr = img.rgba[o] - pr;
        const dg = img.rgba[o + 1] - pg;
        const db = img.rgba[o + 2] - pb;
        const d = dr * dr + dg * dg + db * db;
        if (d < best) { best = d; bx = x; by = y; }
      }
    }
    const o = (by * img.width + bx) * 4;
    const snapped = `#${[img.rgba[o], img.rgba[o + 1], img.rgba[o + 2]]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()}`;
    out[role] = { hex: entry.hex, snapped, at: [bx, by] };
  }
  return out;
}

// ------------------------------------------------------------------- matte

// Difference matting (triangulation matting with two known backings).
// An observed pixel is foreground composited over a backing:
//   observed = alpha * color + (1 - alpha) * backing
// With the same foreground shot over a light backing L and a dark backing
// D, subtracting the two observations cancels the foreground term:
//   observedL - observedD = (1 - alpha) * (L - D)
// so per channel: alpha = 1 - (observedL - observedD) / (L - D), and the
// true color unpremultiplies from the dark observation, whose backing
// contributes nothing: color = darkObs / alpha. No key color means nothing
// to spill (what broke the chroma approach); contact shadows fall out as
// semi-transparent black, a natural drop shadow.

// The model never renders the backing at its exact nominal hex, so read
// the real backing off each image instead: per-channel median of the
// outer border ring, which the sheet's isolation rules guarantee is pure
// background.
function estimateBacking(img, inset = 4) {
  const { width: w, height: h, rgba } = img;
  const samples = [[], [], []];
  const take = (x, y) => {
    const o = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) samples[c].push(rgba[o + c]);
  };
  for (let x = 0; x < w; x += 3) { take(x, inset); take(x, h - 1 - inset); }
  for (let y = 0; y < h; y += 3) { take(inset, y); take(w - 1 - inset, y); }
  return samples.map((arr) => {
    arr.sort((a, b) => a - b);
    return arr[arr.length >> 1];
  });
}

function cmdMatte(args) {
  const [lightFile, darkFile] = args._;
  if (!lightFile || !darkFile || !args.out) {
    fail('usage: visual-cues.mjs matte <light.png> <dark.png> --out <final.png>');
  }
  const light = decodePng(readFileSync(resolve(lightFile)));
  const dark = decodePng(readFileSync(resolve(darkFile)));
  requireSquare(light, 'light pass');
  requireSquare(dark, 'dark pass');
  if (light.width !== dark.width || light.height !== dark.height) {
    fail(`size mismatch: light ${light.width}x${light.height} vs dark ${dark.width}x${dark.height}; regenerate the dark pass at the light pass's exact size`);
  }
  const backingL = estimateBacking(light);
  const backingD = estimateBacking(dark);
  const meanSpan = (backingL[0] - backingD[0] + backingL[1] - backingD[1] + backingL[2] - backingD[2]) / 3;
  if (meanSpan < 96) {
    fail(`backings too similar to matte (light ${JSON.stringify(backingL)} vs dark ${JSON.stringify(backingD)}); the dark pass likely kept the light background`);
  }

  const n = light.width * light.height;
  const out = Buffer.alloc(n * 4);
  let transparent = 0;
  let opaque = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    // Average the per-channel alpha estimates; channels where the two
    // backings barely differ carry no signal and are skipped.
    let sum = 0;
    let used = 0;
    for (let c = 0; c < 3; c++) {
      const span = backingL[c] - backingD[c];
      if (Math.abs(span) < 48) continue;
      sum += 1 - (light.rgba[o + c] - dark.rgba[o + c]) / span;
      used++;
    }
    let a = used ? Math.round(255 * Math.max(0, Math.min(1, sum / used))) : 255;
    // Snap the ends: generation noise leaves alpha a few counts off the
    // rails, which would otherwise put a faint film over the whole
    // background and pinholes inside solid objects.
    if (a <= 16) a = 0;
    else if (a >= 240) a = 255;
    if (a === 0) transparent++;
    else if (a === 255) opaque++;
    for (let c = 0; c < 3; c++) {
      // Recover true color from the dark pass, removing its (near-black)
      // backing contribution before unpremultiplying.
      if (a === 0) { out[o + c] = 0; continue; }
      const fg = dark.rgba[o + c] - ((255 - a) / 255) * backingD[c];
      out[o + c] = Math.max(0, Math.min(255, Math.round((fg * 255) / a)));
    }
    out[o + 3] = a;
  }
  writeFileSync(resolve(args.out), encodePng(out, light.width, light.height));
  console.log(JSON.stringify({
    ok: true,
    out: resolve(args.out),
    width: light.width,
    height: light.height,
    // Callers judge the matte from these: a healthy four-object sheet cuts
    // out to a mostly-transparent canvas with solid object cores. Tiny
    // transparentPct means the dark pass never replaced the background;
    // tiny opaquePct means the two passes disagree everywhere (the model
    // moved or redrew the objects between passes).
    transparentPct: Math.round((100 * transparent) / n),
    opaquePct: Math.round((100 * opaque) / n),
    partialPct: Math.round((100 * (n - transparent - opaque)) / n),
  }, null, 2));
}

// ---------------------------------------------------------------- cues.json

// Reads the existing cues.json (if any) and merges this cue in, so cropping
// the six concepts one after another accumulates into one shared manifest
// instead of each crop overwriting the last.
function updateCuesJson(outDir, slug, artifactIds, palette) {
  const path = join(outDir, 'cues.json');
  let data = {};
  if (existsSync(path)) data = JSON.parse(readFileSync(path, 'utf8'));
  data.cues = data.cues || [];
  data['supporting-artifacts'] = data['supporting-artifacts'] || {};
  if (!data.cues.includes(slug)) data.cues.push(slug);
  data['supporting-artifacts'][slug] = artifactIds;
  if (palette) {
    data.palette = data.palette || {};
    data.palette[slug] = palette;
  }
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  return data;
}

// -------------------------------------------------------------------- CLI

// Minimal flag parser: positional args collect into `_`, everything after
// a `--name` becomes args.name. Good enough for this script's small,
// fixed set of options; no need for a dependency here.
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    } else {
      args._.push(argv[i]);
    }
  }
  return args;
}

// Errors surface as JSON on stderr (matching the success shape on stdout)
// so the calling agent can parse either outcome the same way.
function fail(msg) {
  console.error(JSON.stringify({ ok: false, error: msg }));
  process.exit(1);
}

function cmdCrop(args) {
  const [heroFile, sheetFile] = args._;
  const slug = args.slug;
  if (!heroFile || !sheetFile || !slug) {
    fail('usage: visual-cues.mjs crop <hero.png> <artifacts.png> --slug <slug> [--palette "..."] [--out <dir>]');
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)+$/.test(slug)) fail(`slug "${slug}" must be lowercase words joined by hyphens (e.g. amber-dusk)`);
  const outDir = resolve(args.out || '.impeccable/visual-cues');
  const hero = decodePng(readFileSync(resolve(heroFile)));
  const sheet = decodePng(readFileSync(resolve(sheetFile)));
  requireSquare(hero, 'hero');
  requireSquare(sheet, 'artifact sheet');

  mkdirSync(join(outDir, 'masters'), { recursive: true });
  const heroPath = join(outDir, `${slug}.png`);
  copyFileSync(resolve(heroFile), heroPath); // the hero ships untouched, no crop
  const keptSheet = join(outDir, 'masters', `${slug}-artifacts.png`);
  copyFileSync(resolve(sheetFile), keptSheet); // uncropped sheet, kept for reference

  // q2..q5 in reading order (top-left, top-right, bottom-left, bottom-right)
  // become <slug>-2.png..<slug>-5.png, matching the numbering documented in
  // reference/visual-cues.md and expected by cues.json readers.
  const qs = quadrants(sheet.width, sheet.height);
  const files = [heroPath];
  const artifactIds = [];
  const order = ['q2', 'q3', 'q4', 'q5'];
  for (let i = 0; i < order.length; i++) {
    const r = qs[order[i]];
    const id = `${slug}-${i + 2}`;
    artifactIds.push(id);
    const outPath = join(outDir, `${id}.png`);
    writeFileSync(outPath, encodePng(cropRegion(sheet, r), r.w, r.h));
    files.push(outPath);
  }

  // --palette is optional: the agent may crop before it has finished
  // designing the palette, and can re-run crop later once it has hexes.
  let palette = null;
  if (args.palette) palette = snapPalette(hero, parsePalette(args.palette));

  updateCuesJson(outDir, slug, artifactIds, palette);

  console.log(JSON.stringify({
    ok: true,
    slug,
    hero: heroPath,
    artifacts: keptSheet,
    files,
    palette,
    cuesJson: join(outDir, 'cues.json'),
  }, null, 2));
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  try {
    if (cmd === 'crop') cmdCrop(args);
    else if (cmd === 'matte') cmdMatte(args);
    else fail('usage: visual-cues.mjs <crop|matte> ... (see reference/visual-cues.md)');
  } catch (err) {
    fail(err.message);
  }
}

// Only auto-run when invoked directly (`node visual-cues.mjs ...`), not
// when another module imports its exports (decodePng, encodePng, etc.),
// e.g. from a test file.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
