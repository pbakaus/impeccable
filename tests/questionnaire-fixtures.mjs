import zlib from 'node:zlib';

import { normalizeAnswer, QUESTIONNAIRE_SLIDES } from '../skill/scripts/questionnaire/schema.mjs';

export const SAMPLE_ANSWER_INPUTS = {
  'project-identity': {
    value: 'A site for small architecture studios to understand billing before client calls.',
  },
  purpose: {
    value: 'Orbit Ledger',
  },
  'primary-user': {
    value: 'A studio founder on mobile, rushed between site visits and checking the next decision.',
  },
  success: {
    value: 'They understand which accounts need action without opening a spreadsheet.',
  },
  'content-data': {
    value: '12 active clients, invoice status, retainer balance, risk tags, notes, and renewal dates.',
  },
  'key-states': {
    value: ['default', 'loading', 'error', 'long-content', 'mobile'],
  },
  'color-strategy': {
    value: 'committed',
  },
  'theme-scene': {
    value: 'A founder at a bright drafting table, using a phone under cool morning light.',
  },
  'visual-north-star': {
    value: 'A Leica rangefinder dial, a museum accession label, and a precise bank statement.',
  },
  'typography-voice': {
    value: 'A technical field manual with roomy margins and calm numeric labels.',
  },
  'component-feel': {
    value: 'tactile-confident',
  },
  'motion-access': {
    value: 'WCAG AA, reduced motion, mobile first, and labels that survive German text.',
  },
  'do-dont': {
    value: 'No fake metrics, no purple gradient glow, no nested cards, and no hidden fees.',
  },
};

export function normalizedSampleAnswers() {
  return Object.fromEntries(
    QUESTIONNAIRE_SLIDES.map((slide) => [
      slide.id,
      normalizeAnswer(slide.id, SAMPLE_ANSWER_INPUTS[slide.id] || { value: '' }),
    ]),
  );
}

export const SAMPLE_INIT_TYPOGRAPHY = [
  {
    id: 'type_museum_warmth',
    label: 'Museum warmth',
    cssUrl: 'https://fonts.googleapis.com/css2?family=Besley:wght@400;600&family=Atkinson+Hyperlegible:wght@400;700&display=swap',
    heading: { family: 'Besley', weights: [400, 600], style: 'Warm object-label serif', fallback: 'serif' },
    body: { family: 'Atkinson Hyperlegible', weights: [400, 700], style: 'Readable product body', fallback: 'sans-serif' },
    sampleHeading: 'Light with a hand in it.',
    sampleBody: 'A grounded voice for product detail, making process, material proof, and the quiet decision to bring Mira home.',
    rationale: 'Besley gives the heading a crafted label quality while Atkinson Hyperlegible keeps product and purchase copy unusually clear.',
    usage: 'Use Besley for short atmosphere-bearing claims; use Atkinson Hyperlegible for proof, specifications, forms, and buying paths.',
    avoid: 'Avoid making the serif too literary or the body too clinical.',
  },
  {
    id: 'type_workshop_label',
    label: 'Workshop label',
    cssUrl: 'https://fonts.googleapis.com/css2?family=Chivo:wght@400;600;700&family=Literata:opsz,wght@7..72,400;7..72,600&display=swap',
    heading: { family: 'Chivo', weights: [600, 700], style: 'Plain workshop display', fallback: 'sans-serif' },
    body: { family: 'Literata', weights: [400, 600], style: 'Material-readable serif', fallback: 'serif' },
    sampleHeading: 'Made slowly. Used nightly.',
    sampleBody: 'The pairing keeps the studio practical while giving product stories enough warmth to feel held, not marketed.',
    rationale: 'Chivo carries object confidence; Literata gives longer material copy a calmer reading texture.',
    usage: 'Use Chivo for navigation, claims, and product labels; use Literata for storytelling and proof.',
    avoid: 'Avoid over-tight tracking on Chivo or dense serif paragraphs.',
  },
  {
    id: 'type_quiet_modern',
    label: 'Quiet modern',
    cssUrl: 'https://fonts.googleapis.com/css2?family=Epilogue:wght@400;500;650&family=Commissioner:wght@400;500;650&display=swap',
    heading: { family: 'Epilogue', weights: [500, 650], style: 'Soft geometric heading', fallback: 'sans-serif' },
    body: { family: 'Commissioner', weights: [400, 500, 650], style: 'Durable commerce body', fallback: 'sans-serif' },
    sampleHeading: 'A lamp that leaves room quiet.',
    sampleBody: 'For a more contemporary route, the system keeps warmth in spacing, light, and imagery while copy stays efficient.',
    rationale: 'Epilogue gives Mira a restrained contemporary edge; Commissioner keeps practical site UI steady.',
    usage: 'Use Epilogue for hero and section claims; use Commissioner for product grids, checkout-adjacent copy, and support.',
    avoid: 'Avoid making the system feel like generic SaaS.',
  },
  {
    id: 'type_studio_note',
    label: 'Studio note',
    cssUrl: 'https://fonts.googleapis.com/css2?family=Gabarito:wght@400;600;700&family=Alegreya+Sans:wght@400;500;700&display=swap',
    heading: { family: 'Gabarito', weights: [600, 700], style: 'Rounded studio display', fallback: 'sans-serif' },
    body: { family: 'Alegreya Sans', weights: [400, 500, 700], style: 'Human product body', fallback: 'sans-serif' },
    sampleHeading: 'Thrown by hand, lit with restraint.',
    sampleBody: 'The type voice feels approachable and crafted without borrowing default wellness or luxury signals.',
    rationale: 'Gabarito provides friendly structure; Alegreya Sans softens longer explanations and process notes.',
    usage: 'Use Gabarito for short memorable structure and Alegreya Sans for material detail.',
    avoid: 'Avoid oversized rounded UI or overly casual tone.',
  },
];

export const SAMPLE_INIT_ANSWER_INPUTS = {
  'product-overview': {
    value: 'Mira is a ceramic lamp studio for people who want quiet, sculptural lighting at home.',
  },
  assets: {
    assets: [
      {
        id: 'asset_product_photo',
        name: 'warm-lamp-product-photo.png',
        type: 'image/png',
        role: 'product-photo',
        path: '.impeccable/init/uploads/q_sample/warm-lamp-product-photo.png',
        previewDataUrl: tinyPngDataUrl('lamp-product'),
        size: 2048,
        width: 32,
        height: 32,
        createdAt: '2026-06-14T00:00:00.000Z',
      },
    ],
  },
  differentiator: {
    value: 'Each lamp is hand-thrown, fired in small batches, and designed to look calm even when switched off.',
  },
  trust: {
    value: 'material honesty',
    label: 'Material honesty',
  },
  'audience-fit': {
    value: 'people who want quiet objects with presence, not visual noise',
    label: 'People who want quiet objects with presence',
  },
  'anti-audience': {
    value: 'not for glossy luxury drama, bargain decor, or trend-led maximalism',
    label: 'No glossy luxury drama',
  },
  'visual-cues': {
    value: ['cue_material', 'cue_graphic', 'cue_motion'],
  },
  palette: {
    value: ['palette_clay_signal'],
  },
  typography: {
    value: ['type_museum_warmth'],
  },
};

export const SAMPLE_INIT_IMAGES = {
  'visual-cues': [
    {
      id: 'cue_material',
      label: 'Thrown clay',
      routeFamily: 'material-object',
      prompt: 'Intent: first-round brand identity cue, not decoration. Brand context: Mira, quiet ceramic lamp studio. Route family: material-object. Concept route: hand-thrown clay edge as proof of human making. Visual language: square studio image, tactile clay surface, soft side light, restrained shadow. Design translation: rounded surface edges, grounded cards, warm texture, slow reveal motion. Constraints: no text, no lettering, no numerals, no logos, no watermark, no UI mockup.',
      dataUrl: tinyPngDataUrl('init-material'),
    },
    {
      id: 'cue_graphic',
      label: 'Quiet orbit',
      routeFamily: 'graphic-shape',
      prompt: 'Intent: first-round brand identity cue, not decoration. Brand context: Mira, quiet ceramic lamp studio. Route family: graphic-shape. Concept route: a simple orbiting shape system that suggests light falloff and calm precision. Visual language: abstract geometric marks, negative space, soft contrast, no literal product. Design translation: icon rhythm, section spacing, focus rings, product diagram logic. Constraints: no text, no lettering, no numerals, no logos, no watermark, no UI mockup.',
      dataUrl: tinyPngDataUrl('init-graphic'),
    },
    {
      id: 'cue_motion',
      label: 'Light sweep',
      routeFamily: 'gesture-motion',
      prompt: 'Intent: first-round brand identity cue, not decoration. Brand context: Mira, quiet ceramic lamp studio. Route family: gesture-motion. Concept route: warm light sweeping softly across a surface. Visual language: motion trail, gentle arc, warm-to-dark transition, uncluttered composition. Design translation: scroll reveals, hover wash, carousel motion, transition timing. Constraints: no text, no lettering, no numerals, no logos, no watermark, no UI mockup.',
      dataUrl: tinyPngDataUrl('init-motion'),
    },
    {
      id: 'cue_surreal',
      label: 'Moon vessel',
      routeFamily: 'surreal-metaphor',
      prompt: 'Intent: first-round brand identity cue, not decoration. Brand context: Mira, quiet ceramic lamp studio. Route family: surreal-metaphor. Concept route: impossible moonlit ceramic vessel hovering in a dark room. Visual language: dreamlike object, quiet glow, deep negative space, controlled surrealism. Design translation: hero atmosphere, depth layers, modal treatment, night-mode palette. Constraints: no text, no lettering, no numerals, no logos, no watermark, no UI mockup.',
      dataUrl: tinyPngDataUrl('init-surreal'),
    },
  ],
  palette: [
    {
      id: 'palette_clay_signal',
      label: 'Clay signal',
      prompt: 'Intent: palette card for Mira based on material-object, graphic-shape, and gesture-motion cue routes. Brand context: quiet ceramic lamp studio. Image content: no-text color-world artifact with clay ground, warm light signal, soft graphite surface, and deep night contrast. Composition: square, independent palette image, no labels. Constraints: no text, no lettering, no numerals, no logos, no watermark, no UI.',
      dataUrl: tinyPngDataUrl('init-palette-1'),
      colors: [
        { name: 'Clay Ground', oklch: 'oklch(89% 0.035 72)' },
        { name: 'Lamp Signal', oklch: 'oklch(74% 0.14 68)' },
        { name: 'Soft Graphite', oklch: 'oklch(42% 0.025 90)' },
        { name: 'Night Vessel', oklch: 'oklch(20% 0.025 85)' },
      ],
      routeFamilies: ['material-object', 'graphic-shape', 'gesture-motion'],
    },
    {
      id: 'palette_orbit',
      label: 'Orbit dusk',
      prompt: 'Intent: palette card for Mira using selected visual cue route families. Constraints: no text, no lettering, no numerals, no logos, no watermark, no UI.',
      dataUrl: tinyPngDataUrl('init-palette-2'),
      colors: [
        { name: 'Porcelain Air', oklch: 'oklch(94% 0.015 96)' },
        { name: 'Dusk Amber', oklch: 'oklch(70% 0.12 72)' },
        { name: 'Muted Umber', oklch: 'oklch(48% 0.05 55)' },
        { name: 'Ink Room', oklch: 'oklch(18% 0.018 80)' },
      ],
      routeFamilies: ['material-object', 'surreal-metaphor', 'atmosphere-light'],
    },
    {
      id: 'palette_shadow_arc',
      label: 'Shadow arc',
      prompt: 'Intent: palette card for Mira using selected visual cue route families. Constraints: no text, no lettering, no numerals, no logos, no watermark, no UI.',
      dataUrl: tinyPngDataUrl('init-palette-3'),
      colors: [
        { name: 'Warm Wall', oklch: 'oklch(90% 0.028 82)' },
        { name: 'Arc Gold', oklch: 'oklch(76% 0.13 78)' },
        { name: 'Clay Rose', oklch: 'oklch(64% 0.075 42)' },
        { name: 'Quiet Black', oklch: 'oklch(16% 0.014 94)' },
      ],
      routeFamilies: ['gesture-motion', 'graphic-shape', 'material-object'],
    },
    {
      id: 'palette_moon_clay',
      label: 'Moon clay',
      prompt: 'Intent: palette card for Mira using selected visual cue route families. Constraints: no text, no lettering, no numerals, no logos, no watermark, no UI.',
      dataUrl: tinyPngDataUrl('init-palette-4'),
      colors: [
        { name: 'Moon Slip', oklch: 'oklch(92% 0.018 110)' },
        { name: 'Kiln Warmth', oklch: 'oklch(68% 0.11 62)' },
        { name: 'Blue Shadow', oklch: 'oklch(46% 0.055 235)' },
        { name: 'Deep Shelf', oklch: 'oklch(22% 0.02 120)' },
      ],
      routeFamilies: ['surreal-metaphor', 'atmosphere-light', 'material-object'],
    },
  ],
};

export function sampleInitImageBatches() {
  return {
    'visual-cues': [
      {
        batchId: 'cue_batch_init_sample',
        slideId: 'visual-cues',
        kind: 'visual-cue',
        createdAt: '2026-06-14T00:00:00.000Z',
        images: SAMPLE_INIT_IMAGES['visual-cues'].map((image) => ({
          ...image,
          batchId: 'cue_batch_init_sample',
          slideId: 'visual-cues',
          kind: 'visual-cue',
          routeFamilyLabel: image.routeFamily,
          createdAt: '2026-06-14T00:00:00.000Z',
        })),
      },
    ],
    palette: [
      {
        batchId: 'palette_batch_init_sample',
        slideId: 'palette',
        kind: 'palette',
        createdAt: '2026-06-14T00:00:00.000Z',
        images: SAMPLE_INIT_IMAGES.palette.map((image) => ({
          ...image,
          batchId: 'palette_batch_init_sample',
          slideId: 'palette',
          kind: 'palette',
          createdAt: '2026-06-14T00:00:00.000Z',
        })),
      },
    ],
  };
}

export function sampleInitTypographyBatches() {
  return {
    typography: [
      {
        batchId: 'type_batch_init_sample',
        slideId: 'typography',
        kind: 'typography',
        createdAt: '2026-06-14T00:00:00.000Z',
        fontSets: SAMPLE_INIT_TYPOGRAPHY.map((fontSet) => ({
          ...fontSet,
          batchId: 'type_batch_init_sample',
          slideId: 'typography',
          kind: 'typography',
          createdAt: '2026-06-14T00:00:00.000Z',
        })),
      },
    ],
  };
}

function tinyPngDataUrl(label) {
  const hue = Math.abs([...label].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % 360;
  const width = 32;
  const height = 32;
  const ground = hslToRgb(hue, 0.48, 0.36);
  const subject = hslToRgb((hue + 46) % 360, 0.70, 0.72);
  const seam = hslToRgb((hue + 112) % 360, 0.58, 0.52);
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(0);
    for (let x = 0; x < width; x += 1) {
      const dx = x - 16;
      const dy = y - 16;
      let color = ground;
      if (dx * dx + dy * dy <= 92) color = subject;
      if (Math.abs(x - y) <= 1 || (x + y) % 13 <= 1) color = seam;
      rows.push(color[0], color[1], color[2], 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.from(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb = [0, 0, 0];
  if (hp >= 0 && hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = l - c / 2;
  return rgb.map((value) => Math.round((value + m) * 255));
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { res, text, json };
}
