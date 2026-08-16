/**
 * Dependency-free PNG decode/encode for the skill scripts.
 *
 * decodePng(buffer) -> { width, height, data } where data is RGBA8 (Uint8Array,
 * width*height*4). Handles every color type (0, 2, 3, 4, 6), bit depths 1-16
 * (16-bit is reduced to 8), all five filters, and Adam7 interlacing.
 *
 * encodePng({ width, height, data }) -> Buffer, RGBA8 in, 8-bit RGBA PNG out.
 *
 * Kept small on purpose: the skill scripts ship without npm dependencies, and
 * comps (gpt-image PNGs) and screenshots (Playwright / harness PNGs) are the
 * only formats the comp-fidelity tooling has to read.
 */
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function isPng(buf) {
  return buf && buf.length > 8 && buf.subarray(0, 8).equals(SIGNATURE);
}

function readChunks(buf) {
  const chunks = [];
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + length);
    chunks.push({ type, data });
    pos += 12 + length;
    if (type === 'IEND') break;
  }
  return chunks;
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Unfilter one pass of scanlines in place; returns the raw (unfiltered) bytes. */
function unfilter(raw, width, height, bpp, bitDepth, channels) {
  const stride = Math.ceil((width * channels * bitDepth) / 8);
  const out = new Uint8Array(stride * height);
  let inPos = 0;
  let prev = null;
  for (let y = 0; y < height; y++) {
    const filter = raw[inPos++];
    const line = out.subarray(y * stride, (y + 1) * stride);
    line.set(raw.subarray(inPos, inPos + stride));
    inPos += stride;
    switch (filter) {
      case 0: break;
      case 1: for (let i = bpp; i < stride; i++) line[i] = (line[i] + line[i - bpp]) & 0xff; break;
      case 2: if (prev) for (let i = 0; i < stride; i++) line[i] = (line[i] + prev[i]) & 0xff; break;
      case 3:
        for (let i = 0; i < stride; i++) {
          const left = i >= bpp ? line[i - bpp] : 0;
          const up = prev ? prev[i] : 0;
          line[i] = (line[i] + ((left + up) >> 1)) & 0xff;
        }
        break;
      case 4:
        for (let i = 0; i < stride; i++) {
          const left = i >= bpp ? line[i - bpp] : 0;
          const up = prev ? prev[i] : 0;
          const ul = prev && i >= bpp ? prev[i - bpp] : 0;
          line[i] = (line[i] + paeth(left, up, ul)) & 0xff;
        }
        break;
      default: throw new Error(`png: unknown filter ${filter} on row ${y}`);
    }
    prev = line;
  }
  return { bytes: out, stride, consumed: inPos };
}

/** Read sample `index` (0-based across the row) from a packed scanline. */
function sampleReader(bitDepth) {
  if (bitDepth === 8) return (line, i) => line[i];
  if (bitDepth === 16) return (line, i) => line[i * 2]; // high byte
  const perByte = 8 / bitDepth;
  const mask = (1 << bitDepth) - 1;
  const scale = 255 / mask;
  return (line, i) => {
    const byte = line[(i / perByte) | 0];
    const shift = 8 - bitDepth * ((i % perByte) + 1);
    return Math.round(((byte >> shift) & mask) * scale);
  };
}

function writePixels(dst, dstWidth, bytes, stride, passWidth, passHeight, colorType, bitDepth, palette, trns, mapX, mapY) {
  const channels = CHANNELS[colorType];
  const read = sampleReader(bitDepth);
  const rawIndex = bitDepth < 8 ? (line, i) => {
    const perByte = 8 / bitDepth;
    const mask = (1 << bitDepth) - 1;
    const byte = line[(i / perByte) | 0];
    const shift = 8 - bitDepth * ((i % perByte) + 1);
    return (byte >> shift) & mask;
  } : read;
  for (let y = 0; y < passHeight; y++) {
    const line = bytes.subarray(y * stride, (y + 1) * stride);
    const dy = mapY(y);
    for (let x = 0; x < passWidth; x++) {
      const dx = mapX(x);
      const o = (dy * dstWidth + dx) * 4;
      let r, g, b, a = 255;
      switch (colorType) {
        case 0: {
          r = g = b = read(line, x);
          if (trns && trns.gray === rawIndex(line, x)) a = 0;
          break;
        }
        case 2: {
          r = read(line, x * 3); g = read(line, x * 3 + 1); b = read(line, x * 3 + 2);
          break;
        }
        case 3: {
          const idx = rawIndex(line, x);
          r = palette[idx * 3]; g = palette[idx * 3 + 1]; b = palette[idx * 3 + 2];
          if (trns && trns.alpha && idx < trns.alpha.length) a = trns.alpha[idx];
          break;
        }
        case 4: {
          r = g = b = read(line, x * 2); a = read(line, x * 2 + 1);
          break;
        }
        case 6: {
          r = read(line, x * 4); g = read(line, x * 4 + 1); b = read(line, x * 4 + 2); a = read(line, x * 4 + 3);
          break;
        }
        default: throw new Error(`png: unsupported color type ${colorType}`);
      }
      dst[o] = r; dst[o + 1] = g; dst[o + 2] = b; dst[o + 3] = a;
    }
  }
  return channels;
}

export function decodePng(buf) {
  if (!isPng(buf)) throw new Error('png: not a PNG (bad signature)');
  const chunks = readChunks(buf);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr) throw new Error('png: missing IHDR');
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`png: unsupported color type ${colorType}`);
  const palChunk = chunks.find((c) => c.type === 'PLTE');
  const palette = palChunk ? palChunk.data : null;
  const trnsChunk = chunks.find((c) => c.type === 'tRNS');
  let trns = null;
  if (trnsChunk) {
    if (colorType === 3) trns = { alpha: trnsChunk.data };
    else if (colorType === 0) trns = { gray: trnsChunk.data.readUInt16BE(0) >> (bitDepth === 16 ? 8 : 0) };
  }
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const raw = zlib.inflateSync(idat);
  const bpp = Math.max(1, Math.ceil((channels * bitDepth) / 8));
  const data = new Uint8Array(width * height * 4);
  const text = {};
  for (const c of chunks) {
    if (c.type === 'tEXt') {
      const z = c.data.indexOf(0);
      if (z > 0) text[c.data.toString('latin1', 0, z)] = c.data.toString('utf8', z + 1);
    }
  }

  if (interlace === 0) {
    const { bytes, stride } = unfilter(raw, width, height, bpp, bitDepth, channels);
    writePixels(data, width, bytes, stride, width, height, colorType, bitDepth, palette, trns, (x) => x, (y) => y);
  } else {
    // Adam7
    const passes = [
      [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
    ];
    let offset = 0;
    for (const [sx, sy, dx, dy] of passes) {
      const pw = Math.ceil((width - sx) / dx);
      const ph = Math.ceil((height - sy) / dy);
      if (pw <= 0 || ph <= 0) continue;
      const { bytes, stride, consumed } = unfilter(raw.subarray(offset), pw, ph, bpp, bitDepth, channels);
      offset += consumed;
      writePixels(data, width, bytes, stride, pw, ph, colorType, bitDepth, palette, trns, (x) => sx + x * dx, (y) => sy + y * dy);
    }
  }
  return { width, height, data, text };
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/**
 * Encode RGBA8 to PNG. `text` (optional) is a map of tEXt keyword -> value.
 * Uses filter type 0 on every row: comps and screenshots compress fine and the
 * encoder stays trivial.
 */
export function encodePng({ width, height, data }, { text = null, level = 6 } = {}) {
  if (data.length !== width * height * 4) throw new Error(`png: data length ${data.length} != ${width}x${height}x4`);
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const parts = [SIGNATURE, chunk('IHDR', ihdr)];
  if (text) {
    for (const [k, v] of Object.entries(text)) {
      parts.push(chunk('tEXt', Buffer.concat([Buffer.from(k, 'latin1'), Buffer.from([0]), Buffer.from(String(v), 'utf8')])));
    }
  }
  parts.push(chunk('IDAT', zlib.deflateSync(raw, { level })));
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}
