// How the persona sees the page, for one journey: what the side panel picked (the hand-off's `sees`), else what the
// persona's card says (its `persona.sees`), else normally. Older eyes or colour-blind, every picture the walk
// sends (stills and film) is drawn the way those eyes see it, with a small label in the corner. The persona works from that picture, and the replay is made of the
// same pictures, so whoever watches sees what it saw. Off, a picture goes as it came.
import { COPY } from './panel/copy.js';

/** sRGB to linear light, and back (the colour-blind matrix is meant for linear light). */
const LINEAR = Float32Array.from({ length: 256 }, (_, v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const STEPS = 4096;
const GAMMA = Uint8ClampedArray.from({ length: STEPS + 1 }, (_, i) => { const c = i / STEPS; return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) + 0.5; });

/**
 * Older eyes: a light blur (presbyopia), contrast pulled towards grey (lower contrast sensitivity, glare), a little
 * dimmer (smaller pupils) and warmer, with less blue (a yellowing lens). Colour-blind: deuteranopia, Machado et al.
 * 2009 at severity 1.0. Each is `rgb' = m · rgb + add`, in 0–1.
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

/**
 * The corner label, so the replay says whose view it is. Top right: the replay shows a picture at the tab's shape from
 * the top down, so a taller picture loses its foot, but never its top or right edge. Sized to the picture, so it stays
 * readable when the replay shrinks a wide picture.
 */
function label(ctx, text, right) {
  const size = Math.max(13, Math.round(right / 80));
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  const width = ctx.measureText(text).width + size * 1.2;
  const left = right - width - size * 0.6;
  ctx.fillStyle = 'rgba(20, 20, 20, 0.78)';
  ctx.beginPath();
  ctx.roundRect(left, size * 0.6, width, size * 2, size / 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + size * 0.6, size * 1.6);
}

/** The ways a journey may see the page, as the side panel names them; and a persona card's names for them. */
export const SIGHTS = ['normal', ...Object.keys(LOOKS)];
const CARD = { 'older-eyes': 'older', 'colour-blind': 'colour-blind' };

/**
 * A picture (base64, `format`) as the persona sees it, as base64 again, drawn at `size` if given; as it came for one
 * who sees normally.
 */
export async function seenAs(data, format = 'png', quality, size = null) {
  const { handoff } = await chrome.storage.session.get('handoff').catch(() => ({}));
  const sight = handoff?.sees ?? CARD[handoff?.persona?.sees];
  const look = Object.hasOwn(LOOKS, sight) ? LOOKS[sight] : null;
  if (!look) return data;
  const picture = await createImageBitmap(new Blob([Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0))], { type: `image/${format}` }));
  const { width, height } = size ?? picture;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // Drawn plain under the blur, so the blur's edges do not fade to nothing.
  ctx.drawImage(picture, 0, 0, width, height);
  if (look.blur) {
    ctx.filter = `blur(${look.blur}px)`;
    ctx.drawImage(picture, 0, 0, width, height);
    ctx.filter = 'none';
  }
  picture.close();
  const pixels = ctx.getImageData(0, 0, width, height);
  recolour(pixels.data, look);
  ctx.putImageData(pixels, 0, 0);
  // A small picture (one element's clip) is all page: no room for the label.
  if (width >= 400 && height >= 120) label(ctx, COPY.seenAs[sight], width);
  const blob = await canvas.convertToBlob({ type: `image/${format}`, ...(quality === undefined ? {} : { quality: quality / 100 }) });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}
