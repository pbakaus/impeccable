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
  const { loadSpec, platePrompt, SPEC_PATH } = await import('./comp-spec.mjs');
  const { decodePng, encodePng } = await import('./lib/png.mjs');
  const { crop, resize } = await import('./lib/raster.mjs');
  const specPath = arg('spec', SPEC_PATH);
  const spec = loadSpec(specPath);
  if (!spec) { console.error(`generate-image: no spec at ${specPath}; run comp-spec.mjs first`); process.exit(1); }
  const region = spec.regions.find((r) => r.id === plateId);
  if (!region) { console.error(`generate-image: no region ${plateId} in ${specPath}; ids: ${spec.regions.map((r) => r.id).join(', ')}`); process.exit(1); }
  if (region.medium !== 'raster') { console.error(`generate-image: region ${plateId} is ${region.medium}, not a plate; set its kind to plate|image|texture in the regions file`); process.exit(1); }
  let comp;
  try { comp = decodePng(fs.readFileSync(spec.comp)); } catch (e) { console.error(`generate-image: cannot read comp ${spec.comp}: ${e.message}`); process.exit(1); }
  const ref = crop(comp, region.px.x, region.px.y, region.px.w, region.px.h);
  const refPath = path.join(path.dirname(specPath), 'crops', `${region.id}.png`);
  fs.mkdirSync(path.dirname(refPath), { recursive: true });
  fs.writeFileSync(refPath, encodePng(ref, { text: { 'impeccable:crop-of': `${spec.comp}#${region.id}` } }));
  const out = arg('out', region.plate);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // closest supported size to the region's aspect; the page crops the rest with object-fit
  const aspect = region.px.w / region.px.h;
  const size = arg('size') || (aspect > 1.2 ? '1536x1024' : aspect < 0.83 ? '1024x1536' : '1024x1024');
  const extra = arg('prompt') || (arg('prompt-file') ? fs.readFileSync(arg('prompt-file'), 'utf8') : '');
  const prompt = [platePrompt(spec, region), extra].filter(Boolean).join(' ');
  plateCtx = { spec, specPath, region, ref, refPath, out, size, prompt, comp, encodePng, resize };
  if (process.env.IMPECCABLE_IMAGE_GEN_FAKE) {
    const up = resize(ref, ref.width * 2, ref.height * 2);
    fs.writeFileSync(out, encodePng(up, { text: { 'impeccable:prompt': prompt } }));
    fs.writeFileSync(`${out}.json`, JSON.stringify({ prompt, createdAt: new Date().toISOString(), tool: 'generate-image.mjs', model: 'fake', plate: region.id, refs: [refPath] }, null, 2));
    console.log(`PLATE: ${out} (${up.width}x${up.height}, fake 2x crop of region ${region.id}, $0.00, no API call)`);
    process.exit(0);
  }
  // fall through to the real call below with the crop as the single --ref
}

async function scorePlate(ctx, outFile) {
  try {
    const { compare } = await import('./comp-diff.mjs');
    const { decodePng } = await import('./lib/png.mjs');
    const plate = decodePng(fs.readFileSync(outFile));
    // a plate ships under object-fit: cover, so score it the way it will show
    const res = compare({ comp: ctx.ref, build: plate, align: 'cover', kind: ctx.region.kind });
    const s = res.whole;
    const min = arg('min') ? parseFloat(arg('min')) : null;
    const line = `PLATE-SCORE ${ctx.region.id} ${(s.overall * 100).toFixed(0)}% against the comp region (structure ${(s.structure * 100).toFixed(0)}%, color ${(s.color * 100).toFixed(0)}%, detail ${(s.detail * 100).toFixed(0)}%)`;
    console.log(line);
    if (s.overall < 0.5) console.log(`PLATE-WARN the plate does not read as region ${ctx.region.id}; open ${outFile} beside ${ctx.refPath} and regenerate with a stricter prompt (or pass a different --ref) before building on it.`);
    if (min != null && s.overall < min) { console.log(`PLATE-REJECTED below --min ${(min * 100).toFixed(0)}%`); process.exit(3); }
  } catch (e) {
    console.log(`PLATE-SCORE unavailable: ${e.message}`);
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
try {
  const { spawnSync } = await import('node:child_process');
  spawnSync(process.execPath, [new URL('./embed-prompt.mjs', import.meta.url).pathname, out, '--prompt', prompt], { stdio: 'ignore' });
  fs.writeFileSync(`${out}.json`, JSON.stringify({ prompt, createdAt: new Date().toISOString(), tool: 'generate-image.mjs', model: 'gpt-image-2', ...(refs.length ? { refs } : {}) }, null, 2));
} catch { /* embedding is best-effort */ }
console.log(`IMAGE: ${out} (${size}, ${quality}, gpt-image-2, billed to your OpenAI key); prompt embedded + sidecar at ${out}.json`);
if (plateCtx) await scorePlate(plateCtx, out);
