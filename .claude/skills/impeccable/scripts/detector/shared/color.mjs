// ─── Section 2: Color Utilities ─────────────────────────────────────────────

function isNeutralColor(color) {
  if (!color || color === 'transparent') return true;

  // rgb/rgba — use channel spread. Threshold 30 ≈ 11.7% of the 0–255 range.
  const rgb = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgb) {
    return (Math.max(+rgb[1], +rgb[2], +rgb[3]) - Math.min(+rgb[1], +rgb[2], +rgb[3])) < 30;
  }

  // oklch()/lch() — chroma is the second numeric component.
  // oklch chroma is ~0–0.4 in sRGB gamut; >= 0.02 reads as tinted, not gray.
  // lch chroma is ~0–150; >= 3 reads as tinted. jsdom emits both formats
  // literally (it does NOT convert them to rgb).
  const oklch = color.match(/oklch\(\s*[\d.]+%?\s*([\d.-]+)/i);
  if (oklch) return parseFloat(oklch[1]) < 0.02;
  const lch = color.match(/lch\(\s*[\d.]+%?\s*([\d.-]+)/i);
  if (lch) return parseFloat(lch[1]) < 3;

  // oklab()/lab() — a and b are signed axes; chroma = sqrt(a² + b²).
  // oklab a/b are ~-0.4..0.4, threshold 0.02. lab a/b are ~-128..127, threshold 3.
  const oklab = color.match(/oklab\(\s*[\d.]+%?\s*([\d.-]+)\s+([\d.-]+)/i);
  if (oklab) {
    const a = parseFloat(oklab[1]), b = parseFloat(oklab[2]);
    return Math.hypot(a, b) < 0.02;
  }
  const lab = color.match(/lab\(\s*[\d.]+%?\s*([\d.-]+)\s+([\d.-]+)/i);
  if (lab) {
    const a = parseFloat(lab[1]), b = parseFloat(lab[2]);
    return Math.hypot(a, b) < 3;
  }

  // hsl/hsla — saturation is the second numeric component (percent).
  // Modern jsdom usually converts hsl() to rgb, but handle it directly for
  // safety across versions and for any engine that preserves the format.
  const hsl = color.match(/hsla?\(\s*[\d.-]+\s*,?\s*([\d.]+)%/i);
  if (hsl) return parseFloat(hsl[1]) < 10;

  // hwb(hue whiteness% blackness%) — a pixel is fully gray when
  // whiteness + blackness >= 100; chroma-like saturation = 1 - (w+b)/100.
  const hwb = color.match(/hwb\(\s*[\d.-]+\s+([\d.]+)%\s+([\d.]+)%/i);
  if (hwb) {
    const w = parseFloat(hwb[1]), b = parseFloat(hwb[2]);
    return (1 - Math.min(100, w + b) / 100) < 0.1;
  }

  // Unknown / unrecognized format — err on the side of DETECTING rather
  // than silently skipping. This is the opposite of the previous default,
  // which was the root cause of the oklch bug.
  return false;
}

function parseRgb(color) {
  if (!color || color === 'transparent') return null;
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
}

function relativeLuminance({ r, g, b }) {
  const [rs, gs, bs] = [r / 255, g / 255, b / 255].map(c =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(c1, c2) {
  const l1 = relativeLuminance(c1);
  const l2 = relativeLuminance(c2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function blendRgba(fg, bg) {
  if (!fg) return bg || null;
  if (!bg || fg.a == null || fg.a >= 0.999) {
    return { r: clampByte(fg.r), g: clampByte(fg.g), b: clampByte(fg.b), a: fg.a == null ? 1 : fg.a };
  }
  const alpha = Math.max(0, Math.min(1, fg.a));
  return {
    r: clampByte(fg.r * alpha + bg.r * (1 - alpha)),
    g: clampByte(fg.g * alpha + bg.g * (1 - alpha)),
    b: clampByte(fg.b * alpha + bg.b * (1 - alpha)),
    a: 1,
  };
}

// APCA 0.0.98G constants, matching apca-w3 0.1.9's main contrast path.
const APCA = {
  mainTRC: 2.4,
  sRco: 0.2126729,
  sGco: 0.7151522,
  sBco: 0.0721750,
  normBG: 0.56,
  normTXT: 0.57,
  revTXT: 0.62,
  revBG: 0.65,
  blkThrs: 0.022,
  blkClmp: 1.414,
  scaleBoW: 1.14,
  scaleWoB: 1.14,
  loBoWoffset: 0.027,
  loWoBoffset: 0.027,
  deltaYmin: 0.0005,
  loClip: 0.1,
};

function srgbToApcaY({ r, g, b }) {
  const toLinear = channel => Math.pow(channel / 255, APCA.mainTRC);
  return APCA.sRco * toLinear(r) + APCA.sGco * toLinear(g) + APCA.sBco * toLinear(b);
}

function apcaContrast(textColor, backgroundColor) {
  if (!textColor || !backgroundColor) return null;
  let textY = srgbToApcaY(textColor);
  let backgroundY = srgbToApcaY(backgroundColor);
  const isOutOfRange = Number.isNaN(textY)
    || Number.isNaN(backgroundY)
    || Math.min(textY, backgroundY) < 0
    || Math.max(textY, backgroundY) > 1.1;
  if (isOutOfRange) return 0;

  textY = textY > APCA.blkThrs ? textY : textY + Math.pow(APCA.blkThrs - textY, APCA.blkClmp);
  backgroundY = backgroundY > APCA.blkThrs
    ? backgroundY
    : backgroundY + Math.pow(APCA.blkThrs - backgroundY, APCA.blkClmp);

  if (Math.abs(backgroundY - textY) < APCA.deltaYmin) return 0;
  if (backgroundY > textY) {
    const contrast = (Math.pow(backgroundY, APCA.normBG) - Math.pow(textY, APCA.normTXT)) * APCA.scaleBoW;
    return (contrast < APCA.loClip ? 0 : contrast - APCA.loBoWoffset) * 100;
  }

  const contrast = (Math.pow(backgroundY, APCA.revBG) - Math.pow(textY, APCA.revTXT)) * APCA.scaleWoB;
  return (contrast > -APCA.loClip ? 0 : contrast + APCA.loWoBoffset) * 100;
}

function parseGradientColors(bgImage) {
  if (!bgImage || !bgImage.includes('gradient')) return [];
  const colors = [];
  for (const m of bgImage.matchAll(/rgba?\([^)]+\)/g)) {
    const c = parseRgb(m[0]);
    if (c) colors.push(c);
  }
  for (const m of bgImage.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const h = m[1];
    if (h.length === 6) {
      colors.push({ r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16), a: 1 });
    } else {
      colors.push({ r: parseInt(h[0]+h[0],16), g: parseInt(h[1]+h[1],16), b: parseInt(h[2]+h[2],16), a: 1 });
    }
  }
  return colors;
}

function hasChroma(c, threshold = 30) {
  if (!c) return false;
  return (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) >= threshold;
}

function getHue(c) {
  if (!c) return 0;
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return Math.round(h * 360);
}

function colorToHex(c) {
  if (!c) return '?';
  return '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('');
}

export {
  isNeutralColor,
  parseRgb,
  relativeLuminance,
  contrastRatio,
  blendRgba,
  apcaContrast,
  parseGradientColors,
  hasChroma,
  getHue,
  colorToHex,
};
