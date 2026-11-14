// How the persona sees the page: an experiment, off unless the options page turns it on (chrome.storage.local
// `walkSight`). With it on, every picture the walk sends (stills and film) is drawn the way older eyes or colour-blind
// eyes see it, with a small label in the corner. The persona works from that picture, and the replay is made of the
// same pictures, so whoever watches sees what it saw. Off, a picture goes as it came.
import { COPY } from './panel/copy.js';

/** sRGB to linear light, and back (the colour-blind matrix is meant for linear light). */
const LINEAR = Float32Array.from({ length: 256 }, (_, v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const STEPS = 4096;
const GAMMA = Uint8ClampedArray.from({ length: STEPS + 1 }, (_, i) => { const c = i / STEPS; return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) + 0.5; });

/**
 * Older eyes: a light blur (presbyopia), contrast pulled towards grey (lower contrast sensitivity, glare), a little
 * dimmer (smaller pupils) and warmer, with less blue (a yellowing lens). Colour-blind: deuteranopia, Machado et al.
 * 2009 at severity 1.0. Each is `rgb' = m · rgb + add`, in 0–1. Research: REN-1892.
 */
const gain = [0.94, 0.92, 0.8];
const contrast = 0.74;
const LOOKS = {
  older: {
    blur: 1.5,
    m: [[gain[0] * contrast, 0, 0], [0, gain[1] * contrast, 0], [0, 0, gain[2] * contrast]],
    add: gain.map((g) => g * (1 - contrast) * 0.5),
  },
  'colour-blind': {
    linear: true,
    m: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
    add: [0, 0, 0],
  },
};

function recolour(px, { m, add, linear }) {
  const toLight = linear ? (v) => LINEAR[v] : (v) => v / 255;
  const back = linear ? (c) => GAMMA[Math.round(Math.min(1, Math.max(0, c)) * STEPS)] : (c) => c * 255 + 0.5;
  for (let at = 0; at < px.length; at += 4) {
    const r = toLight(px[at]); const g = toLight(px[at + 1]); const b = toLight(px[at + 2]);
    px[at] = back(m[0][0] * r + m[0][1] * g + m[0][2] * b + add[0]);
    px[at + 1] = back(m[1][0] * r + m[1][1] * g + m[1][2] * b + add[1]);
    px[at + 2] = back(m[2][0] * r + m[2][1] * g + m[2][2] * b + add[2]);
  }
}

/** The corner label, bottom left, so the replay says whose view it is. */
function label(ctx, text, height) {
  ctx.font = '600 13px system-ui, sans-serif';
  const width = ctx.measureText(text).width + 16;
  ctx.fillStyle = 'rgba(20, 20, 20, 0.78)';
  ctx.beginPath();
  ctx.roundRect(8, height - 34, width, 26, 6);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 16, height - 21);
}

/** A picture (base64, `format`) as the persona sees it, as base64 again; as it came while the experiment is off. */
export async function seenAs(data, format = 'png', quality) {
  const sight = (await chrome.storage.local.get('walkSight').catch(() => ({})))?.walkSight;
  const look = Object.hasOwn(LOOKS, sight) ? LOOKS[sight] : null;
  if (!look) return data;
  const picture = await createImageBitmap(new Blob([Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0))], { type: `image/${format}` }));
  const { width, height } = picture;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // Drawn plain under the blur, so the blur's edges do not fade to nothing.
  ctx.drawImage(picture, 0, 0);
  if (look.blur) {
    ctx.filter = `blur(${look.blur}px)`;
    ctx.drawImage(picture, 0, 0);
    ctx.filter = 'none';
  }
  picture.close();
  const pixels = ctx.getImageData(0, 0, width, height);
  recolour(pixels.data, look);
  ctx.putImageData(pixels, 0, 0);
  label(ctx, COPY.seenAs[sight], height);
  const blob = await canvas.convertToBlob({ type: `image/${format}`, ...(quality === undefined ? {} : { quality: quality / 100 }) });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}
