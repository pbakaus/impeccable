const clamp = (value) => Math.min(1, Math.max(0, value));
const linearize = (value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const gamma = (value) => value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
const parseHex = (hex) => hex.match(/[\da-f]{2}/gi).map((value) => Number.parseInt(value, 16) / 255);

function toLinearRgb([L, C, H]) {
  const angle = H * Math.PI / 180;
  const a = C * Math.cos(angle);
  const b = C * Math.sin(angle);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function oklchToHex([lightness, chroma, hue]) {
  const L = clamp(lightness);
  let C = Math.max(0, chroma);
  let rgb = toLinearRgb([L, C, hue]);
  while (C > 0 && rgb.some((channel) => channel < 0 || channel > 1)) {
    C = Math.max(0, C - 0.005);
    rgb = toLinearRgb([L, C, hue]);
  }
  return `#${rgb.map((channel) => Math.round(clamp(gamma(channel)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

export function hexToOklch(hex) {
  const [red, green, blue] = parseHex(hex).map(linearize);
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(a, b);
  return [L, C, C < 0.00001 ? 0 : (Math.atan2(b, a) * 180 / Math.PI + 360) % 360];
}

export function formatOklch(hex) {
  const [L, C, H] = hexToOklch(hex);
  return `oklch(${(L * 100).toFixed(1)}% ${C.toFixed(3)} ${H.toFixed(1)})`;
}

/** Expand one curated seed into the four questionnaire roles. */
export function seedToRoles(seed) {
  const [L, C, H] = seed.oklch;
  return {
    primary: oklchToHex([L, C, H]),
    secondary: oklchToHex([L < 0.5 ? L + 0.18 : L - 0.18, C * 0.6, H]),
    tertiary: oklchToHex([0.62, Math.min(0.23, Math.max(C, 0.15)), (H + 60) % 360]),
    neutral: oklchToHex([L < 0.55 ? 0.96 : 0.2, 0.01, H]),
  };
}

export function contrastInk(hex) {
  const [red, green, blue] = parseHex(hex).map(linearize);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue > 0.22
    ? 'var(--ks-champagne)'
    : 'var(--ks-lacquer-raised)';
}
