#!/usr/bin/env node
/**
 * API image generation fallback: renders a mock or world board with the
 * user's own OpenAI key when the harness has no native image generation.
 *
 * context.mjs reports availability (it checks OPENAI_API_KEY); harness-native
 * generation always wins when present. This uses gpt-image-2 and spends the
 * user's API credit (roughly $0.05-0.25 per image at default quality), so the
 * skill states that before the first call in a session.
 *
 *   node generate-image.mjs --prompt "..." --out mock.png [--size 1536x1024] [--quality medium]
 *   node generate-image.mjs --prompt-file prompt.txt --out mock.png
 *   node generate-image.mjs --prompt "..." --out mock.png --ref screenshot.png [--ref more.png]
 *
 * --ref anchors generation on input image(s) via the edits endpoint: pass a
 * captured screenshot of a representative existing page when comping a new
 * surface for an established world, so the identity comes from the real UI.
 *
 *   node generate-image.mjs --plate <region-id> [--spec .impeccable/build/spec.json] [--quality high]
 *
 * --plate produces a shipping raster for one raster region of the measured
 * comp spec (comp-spec.mjs): it crops the region from the approved comp,
 * sends the crop as the reference with the spec's plate prompt (plus any
 * --prompt you add), picks the closest supported output size to the region's
 * aspect, writes the result to the region's `plate` path, embeds the prompt,
 * and scores the plate against the comp crop with comp-diff so a plate that
 * does not read as the region is reported (and, with --min, refused) here,
 * before it lands on the page. In IMPECCABLE_IMAGE_GEN_FAKE mode the plate is
 * the crop itself at 2x, so offline pipelines can walk the plate gate.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : fallback;
}

// ---------------------------------------------------------------------------
// Fake mode (IMPECCABLE_IMAGE_GEN_FAKE=1)
//
// Deterministic offline stand-in for the OpenAI call: same prompt -> identical
// bytes, no network, no key, cost line reads $0.00. Used by the new-work smoke
// suite so the concept/serve-question/image chain can run without spend. The
// output renders the prompt over a 2-3 color palette hashed from the prompt,
// plus a "SYNTHETIC COMP" corner label. SVG carries the readable text; the
// raster (.png/.webp/.jpg) fallback carries palette stripes and stows the
// prompt + marker in a PNG tEXt chunk so downstream stays a valid image.
// ---------------------------------------------------------------------------

// FNV-1a 32-bit: tiny, dependency-free, stable across runs and platforms.
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hslToRgb(hDeg, s, l) {
  const h = ((hDeg % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)].map((c) => Math.round(c * 255));
}

const toHex = ([r, g, b]) =>
  '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');

// Two or three deterministic swatches derived from the prompt hash. The band
// count itself is prompt-derived, so different prompts differ in palette.
function palette(prompt) {
  const h = hash32(prompt);
  const base = h % 360;
  const bands = 2 + (h >>> 9) % 2; // 2 or 3
  const spread = 40 + (h >>> 3) % 120;
  const out = [];
  for (let i = 0; i < bands; i++) {
    const hue = base + i * spread;
    const light = 0.32 + ((h >>> (i * 5)) % 40) / 100; // 0.32 - 0.71
    out.push(hslToRgb(hue, 0.55, light));
  }
  return out;
}

function svgFake(prompt, [w, h]) {
  const colors = palette(prompt).map(toHex);
  const stops = colors
    .map((c, i) => `<stop offset="${Math.round((i / (colors.length - 1)) * 100)}%" stop-color="${c}"/>`)
    .join('');
  // Greedy word wrap tuned to the canvas width so the prompt stays legible.
  const perLine = Math.max(12, Math.floor(w / 26));
  const words = String(prompt).replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let cur = '';
  for (const word of words) {
    if ((cur + ' ' + word).trim().length > perLine) {
      if (cur) lines.push(cur);
      cur = word;
    } else {
      cur = (cur + ' ' + word).trim();
    }
    if (lines.length >= 10) break;
  }
  if (cur && lines.length < 11) lines.push(cur);
  const escape = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const fontSize = Math.round(w / 24);
  const startY = h / 2 - ((lines.length - 1) * fontSize * 1.3) / 2;
  const text = lines
    .map((line, i) => `<text x="${w / 2}" y="${Math.round(startY + i * fontSize * 1.3)}" font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${escape(line)}</text>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  <rect x="0" y="0" width="${w}" height="${h}" fill="#000000" fill-opacity="0.22"/>
  ${text}
  <rect x="${w - Math.round(w / 4.2)}" y="${h - Math.round(h / 16)}" width="${Math.round(w / 4.2)}" height="${Math.round(h / 16)}" fill="#000000" fill-opacity="0.55"/>
  <text x="${w - Math.round(w / 8.4)}" y="${h - Math.round(h / 32)}" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(w / 60)}" letter-spacing="2" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">SYNTHETIC COMP</text>
</svg>
`;
}

// Minimal valid PNG: palette stripes plus a tEXt chunk carrying the marker and
// prompt, so a .png/.webp fake stays a decodable image and still contains the
// "SYNTHETIC" bytes downstream tools look for.
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'latin1');
  const body = Buffer.concat([typeBuf, data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function pngFake(prompt, [w, h]) {
  const colors = palette(prompt); // [[r,g,b], ...]
  const bandH = Math.ceil(h / colors.length);
  // Raw image: each scanline prefixed with a 0 filter byte, RGB pixels.
  const stride = w * 3;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    const [r, g, b] = colors[Math.min(colors.length - 1, Math.floor(y / bandH))];
    for (let x = 0; x < w; x++) {
      const p = rowStart + 1 + x * 3;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: truecolor RGB
  const idat = zlib.deflateSync(raw, { level: 9 });
  const textData = Buffer.concat([
    Buffer.from('Comment', 'latin1'),
    Buffer.from([0]),
    Buffer.from(`SYNTHETIC COMP: ${String(prompt).replace(/\s+/g, ' ').trim()}`, 'latin1'),
  ]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('tEXt', textData),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function parseSize(sizeStr) {
  const m = String(sizeStr).match(/^(\d+)x(\d+)$/);
  if (!m) return [1536, 1024];
  return [Number(m[1]), Number(m[2])];
}

// ---------------------------------------------------------------------------
// Plate mode: one raster region of the measured spec -> a shipping plate.
// ---------------------------------------------------------------------------
const plateId = arg('plate');
let plateCtx = null;
if (plateId) {
  const { loadSpec, platePrompt, plateReference, SPEC_PATH } = await import('./comp-spec.mjs');
  const { decodePng, encodePng, loadRaster } = await import('./lib/png.mjs');
  const { crop, resize } = await import('./lib/raster.mjs');
  const specPath = arg('spec', SPEC_PATH);
  const spec = loadSpec(specPath);
  if (!spec) { console.error(`generate-image: no spec at ${specPath}; run comp-spec.mjs first`); process.exit(1); }
  const region = spec.regions.find((r) => r.id === plateId);
  if (!region) { console.error(`generate-image: no region ${plateId} in ${specPath}; ids: ${spec.regions.map((r) => r.id).join(', ')}`); process.exit(1); }
  if (region.medium !== 'raster') { console.error(`generate-image: region ${plateId} is ${region.medium}, not a plate; set its kind to plate|image|texture in the regions file`); process.exit(1); }
  let comp;
  try { comp = loadRaster(spec.comp).image; } catch (e) { console.error(`generate-image: cannot read comp ${spec.comp}: ${e.message}`); process.exit(1); }
  const ref = plateReference(comp, spec, region);
  const refPath = path.join(path.dirname(specPath), 'crops', `${region.id}.png`);
  fs.mkdirSync(path.dirname(refPath), { recursive: true });
  fs.writeFileSync(refPath, encodePng(ref, { text: { 'impeccable:crop-of': `${spec.comp}#${region.id}` } }));
  const out = arg('out', region.plate);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // Closest supported size to the region's aspect; the page crops the rest
  // with object-fit. The plates gate demands >= 1.5x the region's width
  // (capped at 1536), so a square region wider than 682px cannot ship from
  // 1024x1024: take the 1536-wide landscape frame instead and let cover crop.
  const aspect = region.px.w / region.px.h;
  const needW = Math.min(1536, Math.ceil(region.px.w * 1.5));
  let size = arg('size');
  if (!size) {
    if (aspect > 1.2) size = '1536x1024';
    else if (aspect < 0.83) size = needW > 1024 ? '1536x1024' : '1024x1536';
    else size = needW > 1024 ? '1536x1024' : '1024x1024';
  }
  const extra = arg('prompt') || (arg('prompt-file') ? fs.readFileSync(arg('prompt-file'), 'utf8') : '');
  // Chroma: an ink-on-ground plate (a line drawing, a figure on flat ground)
  // is generated on a flat key color and keyed to alpha, so the page's own
  // ground shows through instead of a second, mismatched paper. Default on
  // for kind plate when the comp region reads as ink over one flat ground;
  // --chroma / --no-chroma force it.
  const wantsChroma = process.argv.includes('--chroma') ? true : process.argv.includes('--no-chroma') ? false : (region.kind === 'plate' && inkOnGround(region));
  const chromaColor = '#00ff00';
  const chromaLine = wantsChroma ? ` Render the artwork on a perfectly flat, uniform bright green background (${chromaColor}) that fills every pixel not covered by the artwork; no paper texture, no vignette, no shadow on the green; the green will be removed and the artwork composited onto the page's own surface.` : '';
  const prompt = [platePrompt(spec, region), extra, chromaLine].filter(Boolean).join(' ');
  plateCtx = { spec, specPath, region, ref, refPath, out, size, prompt, comp, encodePng, resize, chroma: wantsChroma ? chromaColor : null };
  if (process.env.IMPECCABLE_IMAGE_GEN_FAKE) {
    const up = resize(ref, ref.width * 2, ref.height * 2);
    fs.writeFileSync(out, encodePng(up, { text: { 'impeccable:prompt': prompt, 'impeccable:fake': '1' } }));
    fs.writeFileSync(`${out}.json`, JSON.stringify({ prompt, createdAt: new Date().toISOString(), tool: 'generate-image.mjs', model: 'fake', plate: region.id, refs: [refPath] }, null, 2));
    console.log(`PLATE: ${out} (${up.width}x${up.height}, fake 2x crop of region ${region.id}, $0.00, no API call)`);
    process.exit(0);
  }
  // fall through to the real call below with the crop as the single --ref
}

/** A region whose crop is dominated by one ground color with a dark second: ink on ground. */
function inkOnGround(region) {
  const pal = region.palette || [];
  if (pal.length < 2) return false;
  return pal[0].coverage >= 0.55;
}

function hexRgb(h) { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h); return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 255, 0]; }

/**
 * Key a flat color to alpha with a soft edge: pixels within `hard` of the key
 * go fully transparent, within `soft` fade, and green spill on edge pixels is
 * pulled toward the ink color. Writes back in place. Returns keyed fraction.
 */
async function keyChroma(file, keyHex) {
  const { decodePng, encodePng } = await import('./lib/png.mjs');
  const img = decodePng(fs.readFileSync(file));
  const [kr, kg, kb] = hexRgb(keyHex);
  // sample the actual key from the corners: generators shift the green
  const corners = [[2, 2], [img.width - 3, 2], [2, img.height - 3], [img.width - 3, img.height - 3]];
  let sr = 0, sg = 0, sb = 0;
  for (const [x, y] of corners) { const p = (y * img.width + x) * 4; sr += img.data[p]; sg += img.data[p + 1]; sb += img.data[p + 2]; }
  const key = [sr / 4, sg / 4, sb / 4];
  const isGreenish = key[1] > 120 && key[1] > key[0] * 1.4 && key[1] > key[2] * 1.4;
  const K = isGreenish ? key : [kr, kg, kb];
  const hard = 60, soft = 120;
  let keyed = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    const d = Math.sqrt((r - K[0]) ** 2 + (g - K[1]) ** 2 + (b - K[2]) ** 2);
    // also treat "greener than both other channels by a margin" as key, for gradients the generator adds
    const greenDom = g > 150 && g - Math.max(r, b) > 60;
    if (d < hard || greenDom) { img.data[i + 3] = 0; keyed++; continue; }
    if (d < soft) {
      const a = (d - hard) / (soft - hard);
      img.data[i + 3] = Math.round(img.data[i + 3] * a);
      // despill: pull green down to the mean of the others on the fringe
      const m = (r + b) / 2; img.data[i + 1] = Math.round(g * a + m * (1 - a));
    }
  }
  // keep the tEXt chunks (the embedded prompt written before keying)
  fs.writeFileSync(file, encodePng(img, { text: img.text && Object.keys(img.text).length ? img.text : null }));
  return keyed / (img.data.length / 4);
}

async function scorePlate(ctx, outFile) {
  try {
    const { compare } = await import('./comp-diff.mjs');
    const { decodePng } = await import('./lib/png.mjs');
    let plate = decodePng(fs.readFileSync(outFile));
    // a keyed plate ships over the page ground: composite it over the region's
    // sampled ground before scoring, the way it will show
    if (ctx.chroma) {
      const { createImage, blit } = await import('./lib/raster.mjs');
      const g = (ctx.region.palette && ctx.region.palette[0] && ctx.region.palette[0].hex) || '#ffffff';
      const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(g);
      const ground = m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16), 255] : [255, 255, 255, 255];
      const over = createImage(plate.width, plate.height, ground);
      blit(over, plate, 0, 0);
      plate = over;
    }
    // a plate ships under object-fit: cover, so score it the way it will show
    const res = compare({ comp: ctx.ref, build: plate, align: 'cover', kind: ctx.region.kind });
    const s = res.whole;
    const min = arg('min') ? parseFloat(arg('min')) : null;
    const line = `PLATE-SCORE ${ctx.region.id} ${(s.overall * 100).toFixed(0)}% against the comp region (structure ${(s.structure * 100).toFixed(0)}%, color ${(s.color * 100).toFixed(0)}%, detail ${(s.detail * 100).toFixed(0)}%)`;
    console.log(line);
    const { plateVerdict } = await import('./build-phase.mjs');
    const v = plateVerdict(ctx.region, s);
    if (!v.ok) console.log(`PLATE-WARN the plate does not read as region ${ctx.region.id}: ${v.reasons.join('; ')}. Open ${outFile} beside ${ctx.refPath} and regenerate before building on it; the plates gate refuses it as it stands.`);
    if (min != null && s.overall < min) { console.log(`PLATE-REJECTED below --min ${(min * 100).toFixed(0)}%`); process.exit(3); }
  } catch (e) {
    console.log(`PLATE-SCORE unavailable: ${e.message}`);
  }
}

// A comp written into .impeccable/mocks/ while a direction is dealt but the
// build phases never started is a comp round happening outside the state
// file, and every session cut after it resumes with no state to follow. The
// roll writes .impeccable/build/pending.json; build-phase.mjs start clears
// it. Refuse mock output until start has run (or --force-mock).
{
  const outArg = arg('out') || (plateCtx && plateCtx.out) || '';
  const intoMocks = /(^|[\\/])\.impeccable[\\/]mocks[\\/]/.test(outArg) && !/[\\/]decision[\\/]/.test(outArg);
  const pending = fs.existsSync(path.join('.impeccable', 'build', 'pending.json'));
  const state = fs.existsSync(path.join('.impeccable', 'build', 'state.json'));
  if (intoMocks && pending && !state && !process.argv.includes('--force-mock')) {
    console.error(`generate-image: a direction was chosen (concept-seed rolled) but build-phase.mjs start has not run, so this comp would be generated outside the build's state. Run: node ${path.dirname(fileURLToPath(import.meta.url))}/build-phase.mjs start --direction <seed key> --kind <assigned|pick|challenger|canon> first (it opens the comps phase), then generate. --force-mock overrides.`);
    process.exit(4);
  }
}

if (process.env.IMPECCABLE_IMAGE_GEN_FAKE) {
  const fakePromptFile = arg('prompt-file');
  const fakePrompt = fakePromptFile ? fs.readFileSync(fakePromptFile, 'utf8') : arg('prompt');
  const fakeOut = arg('out');
  if (!fakePrompt || !fakeOut) {
    console.error('generate-image: --prompt (or --prompt-file) and --out are required.');
    process.exit(1);
  }
  const dims = parseSize(arg('size', '1536x1024'));
  const bytes = fakeOut.endsWith('.svg')
    ? Buffer.from(svgFake(fakePrompt, dims), 'utf8')
    : pngFake(fakePrompt, dims);
  fs.writeFileSync(fakeOut, bytes);
  console.log(`IMAGE: ${fakeOut} (${dims[0]}x${dims[1]}, fake synthetic comp, $0.00, no API call)`);
  process.exit(0);
}

const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.error('generate-image: OPENAI_API_KEY is not set; use the harness-native image tool instead.');
  process.exit(1);
}
const promptFile = arg('prompt-file');
const prompt = plateCtx ? plateCtx.prompt : (promptFile ? fs.readFileSync(promptFile, 'utf8') : arg('prompt'));
const out = plateCtx ? plateCtx.out : arg('out');
if (!prompt || !out) {
  console.error('generate-image: --prompt (or --prompt-file) and --out are required.');
  process.exit(1);
}
const size = plateCtx ? plateCtx.size : arg('size', '1536x1024');
const quality = arg('quality', plateCtx ? 'high' : 'medium');
// Reference images (--ref, repeatable): route through the edits endpoint,
// which accepts input images. This is how a comp for an established world
// inherits the real UI's identity from a captured screenshot instead of a
// prose paraphrase of it; the prompt then describes the NEW surface and the
// reference carries palette, type, and component character.
const refs = (() => {
  const found = plateCtx ? [plateCtx.refPath] : [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === '--ref' && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) found.push(process.argv[i + 1]);
  }
  return found;
})();

let response;
if (refs.length) {
  const form = new FormData();
  form.append('model', 'gpt-image-2');
  form.append('prompt', prompt);
  form.append('size', size);
  form.append('quality', quality);
  form.append('n', '1');
  for (const ref of refs) {
    const bytes = fs.readFileSync(ref);
    const type = ref.endsWith('.png') ? 'image/png' : ref.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    form.append('image[]', new Blob([bytes], { type }), ref.split('/').pop());
  }
  response = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
} else {
  response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-image-2', prompt, size, quality, n: 1 }),
  });
}
if (!response.ok) {
  console.error(`generate-image: API error ${response.status}: ${(await response.text()).slice(0, 300)}`);
  process.exit(1);
}
const json = await response.json();
const b64 = json?.data?.[0]?.b64_json;
if (!b64) {
  console.error('generate-image: no image in response');
  process.exit(1);
}
fs.writeFileSync(out, Buffer.from(b64, 'base64'));
// The prompt travels with the asset: embedded in the file itself (EXIF-class
// metadata via embed-prompt.mjs) so intent survives copies across harnesses,
// plus a sidecar for anything that indexes rather than opens the image.
let embedded = false;
try {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./embed-prompt.mjs', import.meta.url)), out, '--prompt', prompt], { stdio: 'ignore' });
  embedded = !result.error && result.status === 0;
  if (!embedded) console.warn('generate-image: failed to embed prompt in the image');
  fs.writeFileSync(`${out}.json`, JSON.stringify({ prompt, createdAt: new Date().toISOString(), tool: 'generate-image.mjs', model: 'gpt-image-2', ...(refs.length ? { refs } : {}) }, null, 2));
} catch { /* embedding is best-effort */ }
console.log(`IMAGE: ${out} (${size}, ${quality}, gpt-image-2, billed to your OpenAI key); ${embedded ? 'prompt embedded + sidecar' : 'sidecar'} at ${out}.json`);
if (plateCtx && plateCtx.chroma) {
  const frac = await keyChroma(out, plateCtx.chroma);
  console.log(`PLATE-CHROMA keyed ${(frac * 100).toFixed(0)}% of pixels to alpha (${plateCtx.chroma}); place with a plain <img> over the page's own ground, no background on the plate. If the keyed fraction is under 20% the generator ignored the key: regenerate with --no-chroma and use mix-blend-mode: multiply instead.`);
}
if (plateCtx) await scorePlate(plateCtx, out);
