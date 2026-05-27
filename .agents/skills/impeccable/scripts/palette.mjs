#!/usr/bin/env node
/**
 * Brand-seed picker. Returns one OKLCH seed color + the mood it most
 * naturally evokes, and teaches the model how to compose a full palette
 * around it.
 *
 * The seed is the brand's anchor color. The 5-role palette (bg, surface,
 * ink, accent, muted) is composed by the caller at runtime using their
 * judgment + the brief (PRODUCT.md / DESIGN.md / user prompt), NOT picked
 * from a frozen 4-color preset.
 *
 * Why: 4-color frozen palettes drift toward safe defaults (warm-cream bg,
 * complementary accent on near-white) regardless of brief. A single seed +
 * the model's own composition lets the same seed produce a dark-mode jazz
 * club or a light-mode hospitality brand depending on what the brief calls
 * for. Tested empirically against curated 4-color palettes; seed approach
 * wins on mood-fit in 3 of 5 cases and ties on the rest.
 *
 * Usage:
 *   node scripts/palette.mjs                  # pick at random
 *   node scripts/palette.mjs --id seed-021    # pick a specific seed
 *   node scripts/palette.mjs --from <key>     # hash <key> to a seed (deterministic)
 *
 * Env vars:
 *   IMPECCABLE_PALETTE_SEED — same as --from; useful for the eval harness
 *     to make runs reproducible.
 */

import crypto from 'node:crypto';

// Seeds are inlined (60 entries, curated by hand). Each carries a mood
// and a strategy that the model judging it produced — surfaced as hints,
// not commands; the brief still drives composition.
const SEEDS = [
  { id: 'seed-000', oklch: [0.40, 0.13, 0],
    mood: 'old-world apothecary — oxblood ledgers, beeswax candlelight, mahogany shelves',
    strategy: 'Anchor the deep oxblood seed as primary, set it against a warm beeswax-cream bg with charred-walnut ink, and lift it with a tarnished-brass accent for an aged, hand-bound feel' },
  { id: 'seed-001', oklch: [0.419, 0.161, 4.9],
    mood: 'Velvet boudoir at dusk — crushed rose petals on dark mahogany, candlelit and intimate',
    strategy: 'Dark mode anchored in a deep oxblood-tinted ground so the seed\'s muted rose reads as candlelight against wood; accent shifts to a warm amber-gold for gilded contrast rather than chromatic harmony.' },
  { id: 'seed-002', oklch: [0.45, 0.15, 0],
    mood: 'oxblood library at dusk — aged leather bindings, brass lamp glow, quiet authority',
    strategy: 'Anchored a deep oxblood primary in a warm near-black room tinted with the same hue, then lifted an amber-brass accent off the red axis to mimic lamplight against burgundy leather.' },
  { id: 'seed-003', oklch: [0.50, 0.20, 0],
    mood: '1930s darkroom — safelight red bleeding through developer trays, hushed and chemical',
    strategy: 'Anchored in a deep oxblood-tinted near-black so the seed crimson reads as glowing safelight; accent shifts to amber to evoke film emulsion warmth without breaking the monochrome hush.' },
  { id: 'seed-004', oklch: [0.546, 0.204, 3.4],
    mood: 'velvet boudoir at dusk — crushed rose silk, low lamplight, powdered cheek',
    strategy: 'Dark mode with a deep mulberry-plum background that lets the rose primary glow like lipstick under lamplight; accent shifts to a warm dusty mauve-gold to mimic candle-warmed skin tones against the cool wine field.' },
  { id: 'seed-005', oklch: [0.55, 0.18, 0],
    mood: '1960s darkroom — safelight red bleeding into developing trays, patient and analog',
    strategy: 'Anchored in a deep oxblood-tinted dark mode so the seed\'s crimson reads as ambient safelight rather than alert, with a desaturated rose primary and a warm amber accent echoing print tongs under bulb glow.' },
  { id: 'seed-007', oklch: [0.70, 0.13, 0],
    mood: 'faded Mediterranean terracotta at dusk — sun-bleached clay walls, dusty rose plaster, the warm hush before evening',
    strategy: 'anchored a warm chalky off-white background against deep oxblood ink, letting the dusty-rose primary read as sun-warmed plaster while a deeper brick accent provides aged-clay depth' },
  { id: 'seed-008', oklch: [0.520, 0.200, 10.4],
    mood: 'Venetian opera house at curtain call — deep crimson velvet, gilded shadow, hushed anticipation',
    strategy: 'Dark mode with a deep wine-tinted background that lets the seed crimson read as illuminated velvet, paired with a warm gold accent shifted across the wheel to evoke brass and candlelight' },
  { id: 'seed-010', oklch: [0.563, 0.223, 11.0],
    mood: 'crushed velvet boudoir — rouge silk in candlelight, intimate and tactile',
    strategy: 'Deep wine-tinted dark mode lets the crimson seed glow like lit silk rather than scream; accent shifts to a dusty rose-gold for warmth without competing.' },
  { id: 'seed-011', oklch: [0.639, 0.207, 13.5],
    mood: 'velvet boudoir at last call — crushed rose silk, lipstick on a champagne glass, low lamplight',
    strategy: 'Anchored the seed as a saturated rose-primary against a deep wine-tinted dark ground, then pulled an antique-gold accent from the opposite warm axis so the room feels candlelit rather than neon.' },
  { id: 'seed-012', oklch: [0.782, 0.103, 11.4],
    mood: 'faded Victorian rose garden at dusk — pressed petals, antique linen, melancholic romance',
    strategy: 'Anchor the dusty rose seed as primary against a warm bone-paper background, lift a deeper oxblood accent for emphasis, and ink in a brown-black so the whole palette reads like aged paper rather than modern white screen.' },
  { id: 'seed-013', oklch: [0.40, 0.13, 18],
    mood: 'oxblood library at dusk — aged leather bindings, lamplight on mahogany, slow conversation',
    strategy: 'Anchored a deep oxblood primary in a near-black wine-tinted dark mode, with a warm parchment ink and a brass accent that shifts hue just enough to read as candlelight against the red.' },
  { id: 'seed-014', oklch: [0.45, 0.15, 18],
    mood: 'Florentine apothecary at dusk — oxblood leather, aged parchment, and slow candlelight',
    strategy: 'Dark mode anchored in a deep oxblood-tinted ground, with primary kept near the seed\'s smoldering crimson and accent shifted to a warm parchment-gold for an old-world ledger contrast.' },
  { id: 'seed-015', oklch: [0.527, 0.202, 22.7],
    mood: 'Spanish bodega at dusk — oxidized vermilion, terracotta shadow, lamplight on aged plaster',
    strategy: 'Anchored the seed as primary and built a warm dark-mode interior around it: deep brick-tinted background, slightly lifted clay surface, parchment ink, and a smoky amber accent shifted toward 60° to evoke lamplight against the vermilion.' },
  { id: 'seed-022', oklch: [0.418, 0.155, 27.2],
    mood: 'Florentine leather-bound study — oxblood ledgers, oil-lamp glow on aged parchment',
    strategy: 'Anchored the seed as primary and built a warm low-chroma parchment surround with deep umber ink, letting the oxblood read as inked seal against aged paper while a burnished gold accent supplies the lamp-flame highlight.' },
  { id: 'seed-023', oklch: [0.427, 0.175, 29.2],
    mood: 'oxblood leather library — lamplight on cracked spines and aged cognac',
    strategy: 'Anchored a deep-tinted dark mode in the seed\'s own hue family so the oxblood primary glows like lamplit leather, with a brass-gold accent struck across the warm axis for that bookbinder\'s foil contrast.' },
  { id: 'seed-024', oklch: [0.464, 0.169, 26.9],
    mood: 'Pompeiian fresco wall — oxidized vermillion pigment under terracotta lamplight, faded but solemn',
    strategy: 'Anchored the seed as primary, sank the background into a deep umber-tinted near-black, and warmed all neutrals along the same 27° axis so the palette reads like firelight on plaster rather than red-on-white.' },
  { id: 'seed-029', oklch: [0.665, 0.222, 25.7],
    mood: 'Moroccan tannery at golden hour — sun-cracked leather, dyed vermillion, dust in the light',
    strategy: 'Anchor the saturated red-orange seed as primary against a warm parchment background, then pull the accent toward a deeper burnt rust to evoke aged dye vats rather than introducing a cool complement that would break the heat.' },
  { id: 'seed-038', oklch: [0.652, 0.229, 34.8],
    mood: 'sun-cured terracotta at dusk — adobe walls in New Mexico holding the last hour of light',
    strategy: 'Deep dusk-tinted background lets the seed read as fired clay rather than alert-orange; accent shifts to a cooler ochre to evoke fading sky against warm earth.' },
  { id: 'seed-041', oklch: [0.673, 0.217, 38.6],
    mood: 'sun-scorched terracotta at dusk — Marrakech rooftop, fired clay holding the day\'s heat',
    strategy: 'Anchored a deep clay-tinted dark mode around the seed so the orange reads as glowing ember rather than logo-bright, with a cooled saffron accent for contrast lift.' },
  { id: 'seed-042', oklch: [0.688, 0.133, 35.8],
    mood: 'terracotta vessel in late afternoon sun — sunbaked clay, weathered adobe, slow southwestern light',
    strategy: 'Anchored the seed as a warm terracotta primary against a deep umber-tinted dark background, with a dusty rose-gold accent that catches like low-angle light on adobe walls.' },
  { id: 'seed-044', oklch: [0.568, 0.149, 45.9],
    mood: 'weathered terracotta at dusk — sun-warmed adobe walls in a New Mexico courtyard as the light goes amber',
    strategy: 'Anchored a warm dark-mode palette in a deep umber-tinted background so the seed\'s burnt-sienna character glows like lamplight on clay, with a cooler ember accent for contrast without breaking the desert-dusk register.' },
  { id: 'seed-048', oklch: [0.733, 0.174, 45.1],
    mood: 'Marrakech souk at golden hour — sun-warmed terracotta, leather goods, spice sacks under amber light',
    strategy: 'Dark mode with a deep umber-tinted background that lets the seed read as glowing copper lantern-light, paired with a desaturated saffron accent in the same warm family to evoke spice and dust rather than contrast-shock.' },
  { id: 'seed-051', oklch: [0.704, 0.189, 49.0],
    mood: 'blacksmith\'s forge at dusk — ember glow against cooling iron',
    strategy: 'Dark mode anchored in a deep blue-black iron tone to let the seed read as live ember; accent shifts to a cooler amber-gold so the primary feels like the hottest point in the fire.' },
  { id: 'seed-053', oklch: [0.773, 0.157, 56.6],
    mood: 'late-afternoon Marrakech souk — sun-baked terracotta walls, saffron dust, leather and unglazed clay',
    strategy: 'Dark mode built on a deep umber-tinted ground so the amber seed reads as lamplight on clay; accent shifted toward rust-red for the leather/spice register, muted ink kept warm to avoid sterile contrast.' },
  { id: 'seed-074', oklch: [0.70, 0.10, 198],
    mood: 'coastal fog at dawn — wet slate, sea-glass, the hush before a harbor wakes',
    strategy: 'Anchored a deep teal-tinted dark mode around the seed hue, pulled the seed itself up as a luminous sea-glass primary, and used a pale sand accent for the warm break of dawn through mist.' },
  { id: 'seed-075', oklch: [0.65, 0.11, 234],
    mood: 'coastal observatory at dawn — cold steel-blue light over a sleeping harbor, instruments humming',
    strategy: 'Deep tinted dark mode anchored in the seed\'s hue, with the primary lifted in luminance to read as \'first light\' against a near-black sea, and a warm amber accent borrowed from sodium dock lamps to break the monochrome chill.' },
  { id: 'seed-076', oklch: [0.70, 0.10, 234],
    mood: 'predawn coastal fog — muted slate-blue light before the harbor wakes',
    strategy: 'Anchored a deep blue-teal background near the seed\'s hue to evoke fog-dimmed water, then floated a slightly lifted seed as primary and warmed the accent toward amber (harbor lamp) for a single point of human warmth.' },
  { id: 'seed-077', oklch: [0.578, 0.130, 241.7],
    mood: 'predawn harbor — cold steel water, fog-muted signal lights before sunrise',
    strategy: 'Deep blue-tinted dark mode anchors the seed as a luminous beacon hue, with a single warm amber accent acting as a distant harbor lamp cutting through the cool fog.' },
  { id: 'seed-078', oklch: [0.705, 0.169, 242.5],
    mood: 'pre-dawn coastal radar room — cold ocean blue glow against deep instrument-panel dark, quiet vigilance',
    strategy: 'Dark mode anchored in a deep blue-black surface tint of the seed; primary is the seed itself acting as luminous signal-light, with a desaturated cyan-leaning accent suggesting screen phosphor, all over near-monochrome cool neutrals.' },
  { id: 'seed-079', oklch: [0.478, 0.136, 251.8],
    mood: 'pre-dawn observatory — cold cobalt sky just before first light, instruments humming',
    strategy: 'Deep tinted dark mode anchored in the seed\'s blue family, with ink and surface lifted into the same hue to feel like one continuous twilight, then a single warm pale-gold accent as the contrasting \'instrument light\'.' },
  { id: 'seed-080', oklch: [0.541, 0.122, 248.2],
    mood: 'pre-dawn observatory — cold steel light on instrument glass, the blue hour before sunrise',
    strategy: 'Anchored a deep blue-tinted dark mode around the seed hue, then introduced a faintly warmer cyan-shifted accent to evoke the moment night air refracts into morning — primary stays close to seed, accent shifts +8° cooler-bright for stellar glint.' },
  { id: 'seed-081', oklch: [0.65, 0.16, 252],
    mood: 'predawn observatory — cold steel sky just before the stars fade, instruments humming quietly',
    strategy: 'Deep blue-tinted dark mode anchored by the seed as primary, with a desaturated cyan accent suggesting starlight on metal — chroma kept low across roles to preserve the hushed, instrument-panel stillness.' },
  { id: 'seed-082', oklch: [0.742, 0.140, 247.4],
    mood: 'pre-dawn alpine observatory — cold thin air, starlight on snow, instruments glowing faintly',
    strategy: 'Dark mode anchored in a deep blue-tinted midnight bg so the seed reads as luminous instrument-light; accent shifts to a pale ice-cyan for that crystalline high-altitude register.' },
  { id: 'seed-083', oklch: [0.340, 0.159, 262.4],
    mood: 'pre-dawn observatory — deep cobalt sky just before the stars fade, instruments cold and precise',
    strategy: 'Dark mode anchored in a deeply tinted version of the seed hue, with the seed itself lifted into a luminous primary like a star against night, plus a cool cyan-shifted accent suggesting telescope optics.' },
  { id: 'seed-084', oklch: [0.476, 0.207, 261.2],
    mood: 'blueprint room at 2am — drafting table lamp on cold cobalt linen, ink still wet',
    strategy: 'Dark mode anchored in a deep blue-violet tinted from the seed\'s hue, with the seed itself elevated as a luminous primary and a warm amber accent acting as the drafting lamp against the cold field.' },
  { id: 'seed-085', oklch: [0.681, 0.132, 258.4],
    mood: 'pre-dawn observatory — cold starlight on brushed steel, instruments humming in the dark',
    strategy: 'Deep blue-tinted dark mode anchored to the seed\'s hue, with the seed itself lifted as primary against near-black sky; a pale icy accent acts as distant starlight, creating cool tonal stratification rather than complementary contrast.' },
  { id: 'seed-086', oklch: [0.767, 0.106, 255.9],
    mood: 'predawn alpine reconnaissance — cold blue half-light before the sun clears the ridge',
    strategy: 'Dark mode with a deep navy-tinted background that lets the seed read as moonlit ice; primary is the seed itself, accent shifts to a glacial cyan to mimic light refracting through snow.' },
  { id: 'seed-087', oklch: [0.40, 0.13, 270],
    mood: 'occult library at dusk — violet ink, candle-warmth on vellum, hushed gravity',
    strategy: 'Anchored a deep indigo-violet primary on a warm parchment background so the seed reads as old ink on aged paper; accent shifts to a muted amber candleflame for a complementary warm whisper without breaking the scholarly hush.' },
  { id: 'seed-088', oklch: [0.476, 0.158, 268.5],
    mood: 'pre-dawn observatory — deep cobalt sky moments before first light, instruments humming',
    strategy: 'Anchored the seed as primary and built a deep blue-violet dark mode with a cold steel-cyan accent to evoke calibrated instruments against night sky, keeping chroma restrained so the indigo reads as atmospheric rather than digital.' },
  { id: 'seed-089', oklch: [0.50, 0.20, 270],
    mood: 'late-night astronomer\'s notebook — deep cobalt ink under a single desk lamp, brass-warm annotations in the margins',
    strategy: 'Anchored the violet seed in a deep blue-violet midnight ground and lifted it slightly for the primary, then placed a warm amber accent opposite on the wheel to mimic incandescent lamplight against night sky.' },
  { id: 'seed-090', oklch: [0.445, 0.206, 279.1],
    mood: 'late-night astronomy lab — deep indigo void, instrument glow, ink on vellum charts',
    strategy: 'Anchor the violet seed as the luminous primary against a deep indigo-tinted dark ground, with a warm amber accent acting as the brass-instrument counterpoint across the color wheel.' },
  { id: 'seed-098', oklch: [0.329, 0.149, 319.8],
    mood: 'velvet curtain at a late-night cabaret — bruised plum and gaslight',
    strategy: 'Dark-mode palette anchored in a deep purple-plum bg pulled from the seed\'s hue, with the seed elevated as primary and a warm gaslight-gold accent across the wheel to evoke stage light against curtain shadow.' },
  { id: 'seed-099', oklch: [0.40, 0.13, 324],
    mood: 'velvet-rope speakeasy at 1am — mulberry plush, low amber lamps, secrets kept',
    strategy: 'Anchored a deep plum-tinted dark mode around the seed, paired a slightly lifted mulberry primary with a warm brass accent for analogous-plus-temperature contrast that reads as candlelit rather than neon.' },
  { id: 'seed-100', oklch: [0.45, 0.15, 324],
    mood: 'velvet boudoir at 2am — mulberry silk, low lamplight, perfumed hush',
    strategy: 'Dark mode anchored in a deep plum-tinted bg lets the mauve seed glow as primary, with a warm peach accent cutting through like candlelight on skin.' },
  { id: 'seed-101', oklch: [0.494, 0.196, 328.1],
    mood: 'Berlin nightclub at 2am — bruised magenta neon bleeding through fog and black concrete',
    strategy: 'Dark mode anchored on a deep violet-black tinted with the seed\'s hue, letting the magenta primary glow like signage while a cooler cyan accent cuts through the haze.' },
  { id: 'seed-102', oklch: [0.55, 0.18, 324],
    mood: '1980s Tokyo neon at 2am — magenta sign-glow reflecting off wet asphalt',
    strategy: 'Deep cyan-tinted near-black bg lets the magenta primary glow like a neon sign, with a cool electric-blue accent acting as the secondary signage reflection.' },
  { id: 'seed-103', oklch: [0.65, 0.16, 324],
    mood: '1980s Tokyo neon at 2am — wet asphalt, magenta signage, the hum of a vending machine',
    strategy: 'Deep tinted dark mode pulling the seed\'s pink-magenta into the background as bruised plum, then pairing the primary with a cyan accent for that signage-against-night-rain contrast.' },
  { id: 'seed-104', oklch: [0.70, 0.13, 324],
    mood: '1980s Tokyo neon at dusk — magenta signage glow over wet asphalt and indigo sky',
    strategy: 'Dark mode with a deep violet-indigo base shifted from the seed hue, letting the magenta primary read as luminous neon while a cyan accent provides the cross-street counter-glow.' },
  { id: 'seed-105', oklch: [0.40, 0.13, 342],
    mood: 'velvet boudoir at dusk — bruised plum, candlelight, and the hush of heavy drapery',
    strategy: 'Dark mode anchored in a deep plum-tinted background so the seed reads as a low-lit room; primary lifts the seed in lightness for legibility, accent shifts to a warm candle-amber across the wheel for intimate contrast.' },
  { id: 'seed-106', oklch: [0.45, 0.15, 342],
    mood: 'velvet boudoir at last call — bruised plum, low lamplight, lipstick on a champagne flute',
    strategy: 'Anchored a deep wine-tinted dark mode around the seed, kept primary close to the seed hue for sultry continuity, and pulled accent toward warm rose-gold so it reads as candlelight against the plum rather than competing chroma.' },
  { id: 'seed-107', oklch: [0.50, 0.20, 342],
    mood: 'Berlin nightclub at 2am — magenta neon bleeding into wet asphalt, intimate and electric',
    strategy: 'Dark mode anchored in a deep violet-tinted black so the seed magenta reads as neon signage; accent shifts to a cool cyan across the wheel for that wet-pavement reflection contrast.' },
  { id: 'seed-109', oklch: [0.55, 0.18, 342],
    mood: '1980s Tokyo neon at 2am — wet pavement reflecting pink signage and electric magenta dusk',
    strategy: 'Deep cool-violet ground lets the magenta primary glow like a neon tube, with a cyan accent acting as the complementary signage flicker across rain-slick surfaces.' },
  { id: 'seed-110', oklch: [0.65, 0.16, 342],
    mood: '1980s Tokyo neon love hotel — humid pink dusk, lacquered chrome, plum-shadow privacy',
    strategy: 'Anchored a deep plum-tinted dark mode around the seed so the rose reads as warm signage light rather than candy; paired with a cool cyan-lilac accent to mimic neon doubling against wet pavement.' },
  { id: 'seed-111', oklch: [0.70, 0.13, 342],
    mood: '1950s Parisian boudoir — powdered rose silk, velvet shadows, gilded mirror light',
    strategy: 'Anchored a dusty rose primary against a deep plum-black ground with a candlelit gold accent — split-complementary warmth pulled from the seed\'s pink to evoke low-lit intimacy rather than sweetness.' },
  { id: 'seed-112', oklch: [0.754, 0.193, 343.4],
    mood: '1980s Tokyo neon boudoir — lacquered pink signage reflecting off wet asphalt at 2am',
    strategy: 'Deep cool-violet ground anchors the seed as luminous neon signage; primary stays close to seed hue with slightly lifted chroma, accent jumps to electric cyan for that wet-asphalt reflection contrast.' },
  { id: 'seed-113', oklch: [0.470, 0.173, 354.8],
    mood: 'velvet boudoir at 2am — bruised rose, candlelit mahogany, the hush after a confession',
    strategy: 'Anchor on a deep wine-tinted background so the seed reads as candlelight on dark plush; pair with a warm amber accent to suggest low filament light cutting through the rose.' },
  { id: 'seed-114', oklch: [0.570, 0.158, 353.3],
    mood: 'boudoir at dusk — velvet rosewood, candlelight on dark silk',
    strategy: 'Anchored a deep wine-tinted dark mode around the seed\'s rose hue, with a warm gold accent across the wheel to evoke candlelight against draped fabric.' },
  { id: 'seed-115', oklch: [0.636, 0.218, 355.3],
    mood: 'Parisian boudoir at dusk — bruised rose silk, velvet shadows, tarnished gilt',
    strategy: 'Anchored the seed as a muted rose-primary against a deep wine-tinted dark ground, then offset it with a tarnished-gold accent on the opposing warm axis to evoke candlelit lacquer rather than romantic pink.' },
  { id: 'seed-116', oklch: [0.734, 0.183, 356.8],
    mood: '1980s Tokyo love hotel neon — humid pink dusk, lacquered chrome, and the hum of a vending machine at 2am',
    strategy: 'Pulled the seed pink into a deep aubergine-black ground so it reads as glowing neon rather than bubblegum, then paired it with a cool cyan-mint accent to mimic the classic magenta/teon sign duality of Shōwa-era signage.' },
];

function parseArgs(argv) {
  const args = { id: null, from: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--id' && argv[i + 1]) { args.id = argv[++i]; }
    else if (a === '--from' && argv[i + 1]) { args.from = argv[++i]; }
  }
  return args;
}

function hashToIndex(key, n) {
  const h = crypto.createHash('sha256').update(key).digest();
  return h.readUInt32BE(0) % n;
}

function pickSeed(seeds, { id, from }) {
  if (id) {
    const found = seeds.find(s => s.id === id);
    if (!found) { console.error(`no seed with id "${id}"`); process.exit(2); }
    return found;
  }
  const envFrom = process.env.IMPECCABLE_PALETTE_SEED;
  const key = from || envFrom;
  if (key) return seeds[hashToIndex(key, seeds.length)];
  return seeds[Math.floor(Math.random() * seeds.length)];
}

function fmtOklch([L, C, H]) {
  return `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${H.toFixed(1)})`;
}

function hueWord(H) {
  if (H < 15 || H >= 345) return 'pure red';
  if (H < 35)  return 'warm red / crimson';
  if (H < 55)  return 'warm coral / burnt orange';
  if (H < 80)  return 'orange / honey';
  if (H < 105) return 'warm amber / honey-gold';
  if (H < 135) return 'yellow-green / olive';
  if (H < 170) return 'green';
  if (H < 200) return 'teal';
  if (H < 230) return 'sky blue';
  if (H < 265) return 'cobalt / indigo';
  if (H < 295) return 'violet / purple';
  if (H < 330) return 'magenta / pink';
  return 'deep pink / rose';
}

// ---------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
const seed = pickSeed(SEEDS, args);
const [L, C, H] = seed.oklch;

// The mood + strategy on each seed were derived by the model that
// originally judged it. We surface them as *hints*, not commands —
// the brief should still drive what the seed becomes.
const moodHint = seed.mood ? ` (one read: "${seed.mood}")` : '';
const strategyHint = seed.strategy ? `\n  - one example strategy: ${seed.strategy}` : '';

// ---------------------------------------------------------------
// Fat tool-exit response — what the model sees on stdout.
// ---------------------------------------------------------------

process.stdout.write(`BRAND SEED · ${seed.id}

Seed color (anchor for your primary brand color):
  ${fmtOklch(seed.oklch)} — ${hueWord(H)}${moodHint}

This is the brand's anchor — a single beautiful color. Compose the rest of
the palette around it using YOUR judgment, the brief (PRODUCT.md /
DESIGN.md / the user's prompt), and the color-strategy guidance already in
SKILL.md.

How to use:

1. Read the brief. Write one specific phrase describing the mood this
   product calls for. Be granular. Good: "1970s travel poster — sun-baked
   warmth, considered", "midnight jazz club — smoky brass, saxophone
   light", "Scandinavian winter morning — quiet light through frost". Bad:
   "modern and clean", "warm and inviting". The first lets you compose; the
   second is generic and will produce generic palettes.

2. The seed's hue (${H.toFixed(0)}°) anchors your primary brand color. You
   choose L and C to match the mood. The same hue can be deep-and-velvet,
   bright-and-confident, or pale-and-faded — pick the one the mood demands.
   Primary's hue should stay within ±10° of the seed.${strategyHint}

3. Now compose the full palette in OKLCH (5 more roles):
     • bg       — the most important architectural choice.
                  CORE PRINCIPLE: the mood lives in the BRAND COLORS
                  (primary + accent) and typography, NOT in the surface.
                  Stripe is warm — its purple does that, bg is pure
                  white. Linear is cool — its blue does that, bg is
                  pure. Notion is warm — its accents do that, bg is
                  near-pure-white. Putting warmth in BOTH primary AND
                  bg is the AI cliché.

                  DEFAULT A — PURE white: exactly oklch(1.000 0.000 0).
                    Not 0.99, not chroma 0.002. Stripe / Notion / Apple
                    use literal #ffffff. Don't add hidden warmth.
                    Refs: Stripe, Notion, Linear (light), Apple.com,
                    Vercel docs, Figma marketing, Loom, Substack.

                  DEFAULT B — PURE black/near-black: L 0.04-0.12,
                    chroma exactly 0.000. No hue tint. Vercel is
                    roughly oklch(0.08 0 0). Pick L for mood; C is 0.
                    Refs: Vercel, A24, Acne, Apple dark, MUBI.

                  ALT 2 — TINTED: chroma 0.015-0.05.
                    Use ONLY when:
                    (a) the mood is EXPLICITLY environmental — the surface
                        IS part of the brand (1920s lacquered interior,
                        leather library, ceramic studio, hotel lobby), or
                    (b) the seed itself is desaturated (chroma < 0.10) and
                        needs a tinted surface to read as a brand.
                    NOT for "feels warm" / "modern + warm" / "moody". If
                    your mood says "warm" but doesn't name a specific
                    environment, use PURE white and let primary carry
                    the warmth.

                  HEURISTIC: if seed chroma > 0.10 AND mood is product-
                  focused (not environment-focused), it's almost always
                  PURE white. Target distribution across many palettes:
                  ~50% pure white, ~25% pure black, ~25% tinted.
     • surface  — bg pulled slightly toward ink (10-15% mix). Same hue
                  family as bg. Used for cards, panels, sections.
     • ink      — body text color. Must reach ≥7:1 contrast vs bg.
                  Can carry the brand hue at low chroma in light mode
                  (slight warmth or coolness toward the brand).
     • accent   — a SECOND brand color, distinct from primary in BOTH
                  hue AND lightness. Picked to complement the mood (not
                  default-complementary across the wheel). Used for
                  badges, status pills, links, accent rules.
     • muted    — secondary text. Ink pulled 40% toward bg, keeping ink's
                  hue. Must reach ≥3.5:1 contrast vs bg.

4. Pick a color STRATEGY (the four steps from SKILL.md):
     • Restrained: tinted neutrals + accent ≤10% — product default
     • Committed: one saturated color carries 30-60% — identity-driven
     • Full palette: 3-4 named roles each used deliberately — brand work
     • Drenched: the surface IS the color — campaign, hero, statement
   The brief picks the strategy. A startup dashboard ≠ a perfume brand.

Hard rules (already in SKILL.md, recapped because the seed step is where
they actually bite):

  - OKLCH only — never hex. Never #RRGGBB.
  - ink-vs-bg WCAG contrast ≥ 7 (body text must be readable)
  - primary chroma ≤ 0.23 (above this, primary glows perceptually and
    no text on it is readable — acid-bright is a UI failure)
  - if primary L > 0.78, primary chroma ≤ 0.18 (the fluorescent zone)
  - primary-vs-accent contrast ≥ 1.7 (they must be visually distinct,
    not two variants of the same hue at similar lightness)
  - avoid the saturated AI attractor zones: claude-beige (warm-cream bg
    + dusty brown primary), forest-green-on-cream, AI-purple-on-white,
    navy-cream-with-orange-accent

Return your composed palette in CSS custom properties using OKLCH, then
build with it. The seed is the start, not the recipe.
`);
