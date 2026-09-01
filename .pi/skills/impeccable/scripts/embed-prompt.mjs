#!/usr/bin/env node
// Embed a generation prompt into an image so the intent travels with the file,
// across harnesses and machines. Read it back with --read.
//
//   node embed-prompt.mjs <image> --prompt "the prompt text"
//   node embed-prompt.mjs <image> --prompt-file prompt.txt
//   node embed-prompt.mjs <image> --read
//   node embed-prompt.mjs --scan <dir...>   # list rasters missing a prompt; exit 3 when any
//
// Formats: PNG (tEXt chunk, keyword "impeccable:prompt"), JPEG (COM segment).
// WebP and anything else fall back to a `<image>.json` sidecar; --read checks
// the sidecar for every format, so the fallback stays recoverable. Embedding
// rewrites a few MB at most: latency is milliseconds, generation is minutes.
// Caveat worth knowing: image optimizers in build pipelines often strip
// metadata from their OUTPUT files; the intent lives on the source asset,
// which is the one a builder reads.

import fs from 'node:fs';
import zlib from 'node:zlib';

const KEYWORD = 'impeccable:prompt';
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const argOf = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };

function imageType(buffer) {
  if (buffer.length > 8 && buffer.readUInt32BE(0) === 0x89504e47) return 'png';
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpeg';
  return null;
}

function readPrompt(imagePath, buffer = fs.readFileSync(imagePath)) {
  const type = imageType(buffer);
  let prompt = type === 'png' ? parsePng(buffer).prompt : type === 'jpeg' ? readJpegCom(buffer) : null;
  if (prompt == null && fs.existsSync(`${imagePath}.json`)) {
    try { prompt = JSON.parse(fs.readFileSync(`${imagePath}.json`, 'utf8')).prompt ?? null; } catch { /* stays null */ }
  }
  return prompt;
}

if (args.includes('--scan')) {
  const targets = args.filter(a => !a.startsWith('--'));
  if (targets.length === 0) { console.error('embed-prompt: --scan needs at least one directory'); process.exit(1); }
  const RASTER = /\.(png|jpe?g|webp)$/i;
  const rasters = [];
  const walk = (p, isRoot) => {
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      const base = p.replace(/\/+$/, '').split('/').pop();
      // Skip installed deps and hidden dirs found during the walk, but honor a
      // hidden dir the caller passed explicitly (e.g. .impeccable/mocks).
      if (!isRoot && (base === 'node_modules' || base.startsWith('.'))) return;
      for (const entry of fs.readdirSync(p)) walk(`${p.replace(/\/+$/, '')}/${entry}`, false);
    } else if (RASTER.test(p)) {
      rasters.push(p);
    }
  };
  for (const target of targets) {
    if (!fs.existsSync(target)) { console.error(`embed-prompt: no such path ${target}`); process.exit(1); }
    walk(target, true);
  }
  let missing = 0;
  for (const raster of rasters) {
    if (readPrompt(raster) == null) { console.log(`MISSING: ${raster}`); missing++; }
  }
  console.log(`SCAN: ${rasters.length} raster${rasters.length === 1 ? '' : 's'}, ${missing} missing`);
  process.exit(missing > 0 ? 3 : 0);
}

if (!file || !fs.existsSync(file)) { console.error('embed-prompt: image file required'); process.exit(1); }

const buf = fs.readFileSync(file);
const type = imageType(buf);

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (data) => { let c = 0xffffffff; for (const b of data) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

function parsePng(buffer) {
  const chunks = [];
  let prompt = null;
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const nul = data.indexOf(0);
    const promptChunk = (type === 'tEXt' || type === 'zTXt')
      && nul !== -1 && data.toString('latin1', 0, nul) === KEYWORD;
    if (prompt == null && promptChunk) {
      prompt = type === 'tEXt'
        ? data.toString('utf8', nul + 1)
        : zlib.inflateSync(data.subarray(nul + 2)).toString('utf8');
    }
    chunks.push({ offset, type, promptChunk, bytes: buffer.subarray(offset, offset + 12 + length) });
    offset += 12 + length;
  }
  return { chunks, prompt };
}

function readJpegCom(b) {
  let off = 2;
  while (off + 4 <= b.length && b[off] === 0xff) {
    const marker = b[off + 1];
    if (marker === 0xda) break; // start of scan: no more segments
    const len = b.readUInt16BE(off + 2);
    if (marker === 0xfe) {
      const text = b.toString('utf8', off + 4, off + 2 + len);
      if (text.startsWith(KEYWORD + '\0')) return text.slice(KEYWORD.length + 1);
    }
    off += 2 + len;
  }
  return null;
}

const sidecar = `${file}.json`;
if (args.includes('--read')) {
  const prompt = readPrompt(file, buf);
  if (prompt == null) { console.error('embed-prompt: no embedded prompt found'); process.exit(2); }
  console.log(prompt);
  process.exit(0);
}

const promptFile = argOf('--prompt-file');
const prompt = argOf('--prompt') ?? (promptFile ? fs.readFileSync(promptFile, 'utf8') : null);
if (!prompt) { console.error('embed-prompt: --prompt or --prompt-file required'); process.exit(1); }

if (type === 'png') {
  // Insert (or replace) our tEXt chunk immediately before IEND.
  const { chunks, prompt: existingPrompt } = parsePng(buf);
  const iend = chunks.find((chunk) => chunk.type === 'IEND')?.offset ?? -1;
  if (iend < 8) { console.error('embed-prompt: malformed PNG'); process.exit(1); }
  // Drop any existing chunk with our keyword to keep embedding idempotent.
  const replacing = existingPrompt != null;
  const body = replacing
    ? Buffer.concat(chunks
      .filter((chunk) => chunk.offset < iend && !chunk.promptChunk)
      .map((chunk) => chunk.bytes))
    : buf.subarray(8, iend);
  const promptChunk = pngChunk('tEXt', Buffer.concat([Buffer.from(KEYWORD, 'latin1'), Buffer.from([0]), Buffer.from(prompt, 'utf8')]));
  const end = replacing ? pngChunk('IEND', Buffer.alloc(0)) : buf.subarray(iend);
  fs.writeFileSync(file, Buffer.concat([buf.subarray(0, 8), body, promptChunk, end]));
  console.log(`EMBEDDED: ${file} (png tEXt, ${prompt.length} chars)`);
} else if (type === 'jpeg') {
  const seg = Buffer.from(`${KEYWORD}\0${prompt}`, 'utf8');
  if (seg.length + 2 > 0xffff) { console.error('embed-prompt: prompt too long for a JPEG segment'); process.exit(1); }
  const com = Buffer.alloc(4 + seg.length);
  com[0] = 0xff; com[1] = 0xfe; com.writeUInt16BE(seg.length + 2, 2); seg.copy(com, 4);
  fs.writeFileSync(file, Buffer.concat([buf.subarray(0, 2), com, buf.subarray(2)]));
  console.log(`EMBEDDED: ${file} (jpeg COM, ${prompt.length} chars)`);
} else {
  fs.writeFileSync(sidecar, JSON.stringify({ prompt, createdAt: new Date().toISOString() }, null, 2));
  console.log(`EMBEDDED: ${sidecar} (sidecar fallback for this format)`);
}
