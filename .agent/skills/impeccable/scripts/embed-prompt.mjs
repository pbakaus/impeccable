#!/usr/bin/env node
// Embed a generation prompt into an image so the intent travels with the file,
// across harnesses and machines. Read it back with --read.
//
//   node embed-prompt.mjs <image> --prompt "the prompt text"
//   node embed-prompt.mjs <image> --prompt-file prompt.txt
//   node embed-prompt.mjs <image> --read
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
const readMode = args.includes('--read');
const argOf = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };

if (!file || !fs.existsSync(file)) { console.error('embed-prompt: image file required'); process.exit(1); }

const buf = fs.readFileSync(file);
const isPng = buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47;
const isJpeg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;

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

function readPngText(b) {
  let off = 8;
  while (off + 12 <= b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString('ascii', off + 4, off + 8);
    if (type === 'tEXt' || type === 'zTXt') {
      const data = b.subarray(off + 8, off + 8 + len);
      const nul = data.indexOf(0);
      if (nul !== -1 && data.toString('latin1', 0, nul) === KEYWORD) {
        if (type === 'tEXt') return data.toString('utf8', nul + 1);
        return zlib.inflateSync(data.subarray(nul + 2)).toString('utf8');
      }
    }
    off += 12 + len;
  }
  return null;
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
if (readMode) {
  let prompt = null;
  if (isPng) prompt = readPngText(buf);
  else if (isJpeg) prompt = readJpegCom(buf);
  if (prompt == null && fs.existsSync(sidecar)) {
    try { prompt = JSON.parse(fs.readFileSync(sidecar, 'utf8')).prompt ?? null; } catch { /* fall through */ }
  }
  if (prompt == null) { console.error('embed-prompt: no embedded prompt found'); process.exit(2); }
  console.log(prompt);
  process.exit(0);
}

const prompt = argOf('--prompt') ?? (argOf('--prompt-file') ? fs.readFileSync(argOf('--prompt-file'), 'utf8') : null);
if (!prompt) { console.error('embed-prompt: --prompt or --prompt-file required'); process.exit(1); }

if (isPng) {
  // Insert (or replace) our tEXt chunk immediately before IEND.
  const iend = buf.indexOf(Buffer.from('IEND', 'ascii')) - 4;
  if (iend < 8) { console.error('embed-prompt: malformed PNG'); process.exit(1); }
  // Drop any existing chunk with our keyword to keep embedding idempotent.
  let body = buf.subarray(8, iend);
  const existing = readPngText(buf);
  if (existing != null) {
    const parts = [];
    let off = 8;
    while (off + 12 <= buf.length && off < iend + 12) {
      const len = buf.readUInt32BE(off);
      const type = buf.toString('ascii', off + 4, off + 8);
      const chunk = buf.subarray(off, off + 12 + len);
      const data = buf.subarray(off + 8, off + 8 + len);
      const nul = data.indexOf(0);
      const ours = (type === 'tEXt' || type === 'zTXt') && nul !== -1 && data.toString('latin1', 0, nul) === KEYWORD;
      if (!ours && type !== 'IEND') parts.push(chunk);
      off += 12 + len;
    }
    body = Buffer.concat(parts).subarray(8 * 0); // parts exclude signature
    fs.writeFileSync(file, Buffer.concat([buf.subarray(0, 8), body, pngChunk('tEXt', Buffer.concat([Buffer.from(KEYWORD, 'latin1'), Buffer.from([0]), Buffer.from(prompt, 'utf8')])), pngChunk('IEND', Buffer.alloc(0))]));
  } else {
    fs.writeFileSync(file, Buffer.concat([buf.subarray(0, iend), pngChunk('tEXt', Buffer.concat([Buffer.from(KEYWORD, 'latin1'), Buffer.from([0]), Buffer.from(prompt, 'utf8')])), buf.subarray(iend)]));
  }
  console.log(`EMBEDDED: ${file} (png tEXt, ${prompt.length} chars)`);
} else if (isJpeg) {
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
