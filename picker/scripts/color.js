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

// Relative luminance of the colors --pk-ink-dark and --pk-ink-light resolve
// to in styles/picker.css: oklch(14% 0.018 95) and oklch(99% 0.008 95).
const INK_DARK_LUMINANCE = 0.0027;
const INK_LIGHT_LUMINANCE = 0.9716;

// The ink sits on a color the user picked, so it must not follow the picker's
// own theme: --ks-champagne and friends invert between light and dark and
// would blank the label on exactly the swatches that need it most. Comparing
// both ratios beats a fixed lightness threshold, which picks the losing ink
// for mid-tones sitting near the cutoff.
export function contrastInk(hex) {
  const swatch = relativeLuminance(hex);
  const against = (ink) => ratio(ink, swatch);
  return against(INK_DARK_LUMINANCE) >= against(INK_LIGHT_LUMINANCE)
    ? 'var(--pk-ink-dark)'
    : 'var(--pk-ink-light)';
}

/** Hex counterpart to contrastInk(), for readableOn() grounds that are CSS vars. */
export function contrastInkHex(hex) {
  return contrastInk(hex).includes('light')
    ? oklchToHex([0.99, 0.008, 95])
    : oklchToHex([0.14, 0.018, 95]);
}

function relativeLuminance(hex) {
  const [red, green, blue] = parseHex(hex).map(linearize);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function ratio(a, b) {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The accent as type rather than as a fill. A color picked because it looks
 * right as a shape on the page is not thereby readable as words on it, and a
 * pale primary on paper is the common way that goes wrong. Only lightness
 * moves, so the hue the user chose is the hue that shows up; a color that
 * already clears the target comes back untouched.
 */
export function readableOn(accent, ground, target = 4.5) {
  const groundLuminance = relativeLuminance(ground);
  if (ratio(relativeLuminance(accent), groundLuminance) >= target) return accent;
  const [L, C, H] = hexToOklch(accent);
  // Toward whichever end of the range the ground leaves room in, by the same
  // comparison contrastInk makes rather than a fixed lightness cutoff.
  const darker = ratio(INK_DARK_LUMINANCE, groundLuminance) >= ratio(INK_LIGHT_LUMINANCE, groundLuminance);
  const step = darker ? -0.015 : 0.015;
  for (let lightness = L + step; lightness > 0.03 && lightness < 1; lightness += step) {
    const candidate = oklchToHex([lightness, C, H]);
    if (ratio(relativeLuminance(candidate), groundLuminance) >= target) return candidate;
  }
  return darker ? '#000000' : '#FFFFFF';
}

// Floors for judging the neutral on screen 02. The neutral paints the large
// surfaces of every preview, so two pairs matter: the fixed swatch inks that
// set text on it, and the primary fills that sit on it.
const NEUTRAL_INK_FLOOR = 7;
const NEUTRAL_PRIMARY_FLOOR = 3;

/**
 * Plain-language warnings when the palette's neutral will cause contrast
 * trouble: an array with one line per failed check, empty when it is safe.
 * The checks run independently, so a neutral that fails both reports both,
 * mid-tone first.
 *
 * Check 1: the better of the two fixed inks must reach 7:1 (the WCAG AAA
 * body-text figure) on the neutral. The inks are near-black and near-white,
 * so 4.5:1 is nearly impossible to fail; 7:1 is the floor that catches
 * mid-tone neutrals which leave no headroom for muted and secondary text.
 *
 * Check 2: the primary must reach 3:1 (WCAG 1.4.11 non-text contrast)
 * against the neutral, because primary button fills and accents sit directly
 * on neutral surfaces and readableOn() only rescues text, never fills.
 *
 * The strings are read by people configuring a palette, not by developers:
 * no ratios, no standards names. Step 8's test matches on them.
 */
export function neutralContrastIssue({ neutral, primary }) {
  const surface = relativeLuminance(neutral);
  const bestInk = Math.max(
    ratio(INK_DARK_LUMINANCE, surface),
    ratio(INK_LIGHT_LUMINANCE, surface),
  );
  const issues = [];
  if (bestInk < NEUTRAL_INK_FLOOR) {
    issues.push('This background is too close to a middle gray, so text on it will be hard to read. Try a much lighter or much darker color.');
  }
  if (ratio(relativeLuminance(primary), surface) < NEUTRAL_PRIMARY_FLOOR) {
    issues.push('Your main color and this background are too similar, so buttons and cards will blend in. Try more difference between them.');
  }
  return issues;
}
