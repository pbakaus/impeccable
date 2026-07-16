#!/usr/bin/env node
// visual-cues.mjs — compile step for document seed visual cues.
// Pipeline doc: skill/reference/visual-cues.md (canonical; this help text is not).
//
// Each cue is one full-bleed hero scene staging a planned four-color palette.
//
//   node visual-cues.mjs compile <hero.png> --slug <two-word-slug>
//       [--palette "primary=#RRGGBB;secondary=...;tertiary=...;neutral=..."]
//       [--out <dir>]   (default: .impeccable/visual-cues)
//     Copies the hero untouched to <slug>.png, finds each planned palette
//     hex's closest pixel in the hero, and updates <out>/cues.json.
//     The hero must be square: generation happens on a square canvas
//     (a size/aspect parameter, not just a prompt line), and a non-square
//     input is a generation to redo, not an image to fix up here.
//
// Dependency-free: PNG decode on node:zlib. Rejects interlaced and
// indexed-color PNGs; convert those with sips/ImageMagick/PIL first.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

// ---------------------------------------------------------------- PNG codec

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// PNG filter type 4 (Paeth): predicts a byte from its left (a), above (b),
// and above-left (c) neighbors, picking whichever of a, b, or a+b-c lands
// closest to the actual gradient. Used by decodePng's unfilter step.
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
  // point (palette search) only ever deals with one shape. 16-bit samples
  // keep only the high byte; visual cues never need more than 8 bits of
  // precision per channel.
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

// ---------------------------------------------------------------- cues.json

// Reads the existing cues.json (if any) and merges this cue in, so compiling
// the six concepts one after another accumulates into one shared manifest
// instead of each compile overwriting the last.
function updateCuesJson(outDir, slug, palette) {
  const path = join(outDir, 'cues.json');
  let data = {};
  if (existsSync(path)) data = JSON.parse(readFileSync(path, 'utf8'));
  data.cues = data.cues || [];
  if (!data.cues.includes(slug)) data.cues.push(slug);
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

function cmdCompile(args) {
  const [heroFile] = args._;
  const slug = args.slug;
  if (!heroFile || !slug) {
    fail('usage: visual-cues.mjs compile <hero.png> --slug <slug> [--palette "..."] [--out <dir>]');
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)+$/.test(slug)) fail(`slug "${slug}" must be lowercase words joined by hyphens (e.g. amber-dusk)`);
  const outDir = resolve(args.out || '.impeccable/visual-cues');
  const hero = decodePng(readFileSync(resolve(heroFile)));
  requireSquare(hero, 'hero');

  mkdirSync(outDir, { recursive: true });
  const heroPath = join(outDir, `${slug}.png`);
  copyFileSync(resolve(heroFile), heroPath); // the hero ships untouched, no crop

  // --palette is optional: the agent may compile before it has finished
  // designing the palette, and can re-run compile later once it has hexes.
  let palette = null;
  if (args.palette) palette = snapPalette(hero, parsePalette(args.palette));

  updateCuesJson(outDir, slug, palette);

  console.log(JSON.stringify({
    ok: true,
    slug,
    hero: heroPath,
    palette,
    cuesJson: join(outDir, 'cues.json'),
  }, null, 2));
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  try {
    if (cmd === 'compile') cmdCompile(args);
    else fail('usage: visual-cues.mjs compile <hero.png> --slug <slug> [options] (see reference/visual-cues.md)');
  } catch (err) {
    fail(err.message);
  }
}

// Only auto-run when invoked directly (`node visual-cues.mjs ...`), not
// when another module imports its exports (decodePng, etc.), e.g. from a
// test file. import.meta.url is Node's realpath of the entry file, so
// argv[1] must be realpath'd too, not just path.resolve'd: a skill
// installed via symlink (the standard `skills link`/install path) makes
// argv[1] the symlink path, which never equality-matches the resolved
// realpath, so main() silently never ran.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) {
  main();
}
