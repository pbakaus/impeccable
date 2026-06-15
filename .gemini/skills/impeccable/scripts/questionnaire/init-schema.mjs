export const INIT_QUESTIONNAIRE_VERSION = 1;

export const INIT_COMMANDS = new Set(['init', 'identity']);

export const INIT_ROUTE_FAMILIES = [
  'material-object',
  'graphic-shape',
  'gesture-motion',
  'atmosphere-light',
  'playful-character',
  'pattern-ornament',
  'surreal-metaphor',
  'editorial-cultural',
];

export const INIT_ROUTE_FAMILY_LABELS = {
  'material-object': 'Material / object',
  'graphic-shape': 'Graphic / shape',
  'gesture-motion': 'Gesture / motion',
  'atmosphere-light': 'Atmosphere / light',
  'playful-character': 'Playful / character',
  'pattern-ornament': 'Pattern / ornament',
  'surreal-metaphor': 'Surreal / metaphor',
  'editorial-cultural': 'Editorial / cultural',
};

export const INIT_SLIDES = [
  {
    id: 'product-overview',
    section: 'What exists',
    kind: 'text',
    title: 'What are we making?',
    prompt: 'Name it, describe it, and say who it is for.',
    placeholder: 'Mira is a ceramic lamp studio for people who want quiet, sculptural lighting at home.',
    designKey: 'productOverview',
    required: true,
    delegable: false,
  },
  {
    id: 'assets',
    section: 'What exists',
    kind: 'upload',
    title: 'What do we already have?',
    prompt: 'Add product photos, testimonials, process shots, GIFs, or videos.',
    uploadNote: 'GIFs are best for quick review. MP4 works too.',
    designKey: 'assets',
    required: false,
    delegable: true,
  },
  {
    id: 'differentiator',
    section: 'What exists',
    kind: 'text',
    title: 'What makes it special?',
    prompt: 'Tell me what people can’t easily get somewhere else.',
    placeholder: 'Each lamp is hand-thrown, fired in small batches, and calm even when switched off.',
    designKey: 'differentiator',
    required: true,
    delegable: true,
  },
  {
    id: 'trust',
    section: 'What it means',
    kind: 'choice',
    title: 'What must feel trustworthy?',
    prompt: 'Choose the proof this brand needs to make obvious.',
    placeholder: 'Or describe the trust signal in your own words.',
    designKey: 'trust',
    required: true,
    options: [],
    delegable: true,
  },
  {
    id: 'audience-fit',
    section: 'What it means',
    kind: 'choice',
    title: 'Who should this reassure first?',
    prompt: 'Pick the person this should immediately make comfortable.',
    placeholder: 'Or describe the person in your own words.',
    designKey: 'audienceFit',
    required: true,
    options: [],
    delegable: true,
  },
  {
    id: 'anti-audience',
    section: 'What it means',
    kind: 'choice',
    title: 'Who is this not for?',
    prompt: 'Name the tastes, clichés, or promises to avoid.',
    placeholder: 'Or describe what the brand should refuse.',
    designKey: 'antiAudience',
    required: true,
    options: [],
    delegable: true,
  },
  {
    id: 'visual-cues',
    section: 'What it means',
    kind: 'visual-cue-grid',
    imageKind: 'visual-cue',
    title: 'What should it carry visually?',
    prompt: 'Choose 2-4 cues that feel like the brand.',
    requestLabel: 'Want another direction?',
    requestPlaceholder: 'More playful, less object-like. Add a graphic route and something surreal.',
    emptyMessage: 'Composing visual directions from your answers and uploaded material.',
    designKey: 'visualCues',
    minSelections: 2,
    maxSelections: 4,
    required: true,
    delegable: true,
  },
  {
    id: 'palette',
    section: 'How it appears',
    kind: 'palette-grid',
    imageKind: 'palette',
    title: 'Which colors feel true?',
    prompt: 'Pick the color world the brand should live in.',
    requestLabel: 'Want a color shift?',
    requestPlaceholder: 'Less beige, more mineral. Keep it calm but make it more memorable.',
    emptyMessage: 'Waiting for palette directions.',
    designKey: 'palette',
    minSelections: 1,
    maxSelections: 1,
    required: true,
    delegable: true,
  },
  {
    id: 'typography',
    section: 'How it appears',
    kind: 'typography-grid',
    title: 'Which type feels right?',
    prompt: 'Pick the heading and body voice.',
    requestLabel: 'Want a different type direction?',
    requestPlaceholder: 'More editorial, less startup. Softer headings, clearer body text.',
    emptyMessage: 'Waiting for typography directions.',
    designKey: 'typography',
    minSelections: 1,
    maxSelections: 1,
    required: true,
    delegable: true,
  },
];

export function getInitSlide(slideId) {
  return INIT_SLIDES.find((slide) => slide.id === slideId) || null;
}

export function getNextInitSlideId(slideId) {
  const index = INIT_SLIDES.findIndex((slide) => slide.id === slideId);
  if (index < 0 || index >= INIT_SLIDES.length - 1) return null;
  return INIT_SLIDES[index + 1].id;
}

export function validateInitCommand(command) {
  if (!INIT_COMMANDS.has(command)) {
    throw new Error(`command must be one of: ${Array.from(INIT_COMMANDS).join(', ')}`);
  }
  return command;
}

export function normalizeInitAnswer(slideId, input, context = {}) {
  const slide = getInitSlide(slideId);
  if (!slide) throw new Error(`Unknown slide: ${slideId}`);
  const raw = input && typeof input === 'object' ? input : { value: input };

  if (slide.kind === 'upload') {
    const assets = normalizeUploadedAssets(raw.assets || raw.value || []);
    return {
      value: assets.map((asset) => asset.id),
      label: assets.length > 0 ? assets.map((asset) => asset.name).join(', ') : 'No assets yet',
      freeform: normalizeFreeform(raw.freeform),
      assets,
    };
  }

  if (slide.kind === 'visual-cue-grid' || slide.kind === 'palette-grid' || slide.kind === 'typography-grid') {
    const values = normalizeIdList(raw.value || raw.selectedIds);
    const min = slide.minSelections || 1;
    const max = slide.maxSelections || min;
    if (slide.required && values.length < min) {
      throw new Error(`${slideId} requires at least ${min} selected ${min === 1 ? 'card' : 'cards'}.`);
    }
    if (values.length > max) {
      throw new Error(`${slideId} allows at most ${max} selected ${max === 1 ? 'card' : 'cards'}.`);
    }
    const items = slide.kind === 'typography-grid'
      ? typographyForIds(values, context.typography || [])
      : imagesForIds(values, context.images || []);
    const answerItems = slide.kind === 'typography-grid'
      ? items.map(summarizeTypographyForAnswer)
      : items.map(summarizeImageForAnswer);
    return {
      value: values,
      label: items.length > 0 ? items.map((item) => item.label || item.id).join(', ') : values.join(', '),
      freeform: normalizeFreeform(raw.freeform),
      batchId: normalizeText(raw.batchId || context.batchId),
      ...(slide.kind === 'typography-grid' ? { typography: answerItems } : { images: answerItems }),
    };
  }

  if (slide.kind === 'choice') {
    const options = optionsForSlide(slide, context);
    const value = normalizeText(raw.value);
    const freeform = normalizeFreeform(raw.freeform);
    const finalValue = value || freeform;
    const option = options.find((candidate) => candidate.value === finalValue || candidate.label === finalValue);
    if (slide.required && !finalValue) throw new Error(`${slideId} requires an answer.`);
    return {
      value: option?.value || finalValue,
      label: normalizeText(raw.label) || option?.label || finalValue,
      freeform,
    };
  }

  const value = normalizeText(raw.value);
  if (slide.required && !value) throw new Error(`${slideId} requires an answer.`);
  return {
    value,
    label: value,
    freeform: normalizeFreeform(raw.freeform),
  };
}

export function initAnswersByKey(answers = {}) {
  const out = {};
  for (const slide of INIT_SLIDES) {
    const answer = answers[slide.id];
    if (!answer) continue;
    out[slide.designKey] = answer;
  }
  return out;
}

export function validateCompleteInitAnswers(answers = {}, context = {}) {
  const missing = [];
  for (const slide of INIT_SLIDES) {
    if (!slide.required) continue;
    try {
      normalizeInitAnswer(slide.id, answers[slide.id], context);
    } catch {
      missing.push(slide.id);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing required answers: ${missing.join(', ')}`);
  }
  return true;
}

export function normalizeInitSlidePatch(slideId, patch = {}) {
  const slide = getInitSlide(slideId);
  if (!slide) throw new Error(`Unknown slide: ${slideId}`);
  const out = {};
  for (const key of ['title', 'prompt', 'uploadNote', 'delegateLabel']) {
    const value = normalizeText(patch[key]);
    if (value) out[key] = value;
  }
  const placeholder = normalizeText(patch.placeholder || patch.requestPlaceholder);
  if (placeholder && slide.kind === 'text') out.placeholder = placeholder;
  if (placeholder && slide.kind === 'choice') out.placeholder = placeholder;
  if (placeholder && (slide.kind === 'visual-cue-grid' || slide.kind === 'palette-grid' || slide.kind === 'typography-grid')) {
    out.requestPlaceholder = placeholder;
  }
  const options = normalizeOptions(patch.options || patch.suggestions);
  if (options.length > 0) out.options = options;
  return out;
}

export function normalizeInitImageBatch({ slideId, batchId, images }) {
  const slide = getInitSlide(slideId);
  if (!slide || (slide.kind !== 'visual-cue-grid' && slide.kind !== 'palette-grid')) {
    throw new Error(`Slide ${slideId} does not accept image batches.`);
  }
  if (!Array.isArray(images) || images.length !== 4) {
    throw new Error('Init image batches must contain exactly 4 images.');
  }
  const normalizedBatchId = normalizeText(batchId) || `${slide.imageKind}-batch-${Date.now().toString(36)}`;
  const createdAt = new Date().toISOString();
  const normalized = images.map((image, index) => normalizeInitImage({
    ...image,
    id: image?.id || `${slide.imageKind}-${Date.now().toString(36)}-${index + 1}`,
    batchId: normalizedBatchId,
    slideId,
    kind: slide.imageKind,
    createdAt: image?.createdAt || createdAt,
  }));
  if (slide.kind === 'visual-cue-grid') {
    const routeFamilies = new Set(normalized.map((image) => image.routeFamily));
    if (routeFamilies.size < 3) {
      throw new Error('Visual cue batches must include at least 3 different route families.');
    }
  }
  return normalized;
}

export function normalizeInitTypographyBatch({ slideId, batchId, fontSets }) {
  const slide = getInitSlide(slideId);
  if (!slide || slide.kind !== 'typography-grid') {
    throw new Error(`Slide ${slideId} does not accept typography batches.`);
  }
  if (!Array.isArray(fontSets) || fontSets.length !== 4) {
    throw new Error('Init typography batches must contain exactly 4 font sets.');
  }
  const normalizedBatchId = normalizeText(batchId) || `type-batch-${Date.now().toString(36)}`;
  const createdAt = new Date().toISOString();
  return fontSets.map((fontSet, index) => normalizeInitTypographySet({
    ...fontSet,
    id: fontSet?.id || `type-${Date.now().toString(36)}-${index + 1}`,
    batchId: normalizedBatchId,
    slideId,
    kind: 'typography',
    createdAt: fontSet?.createdAt || createdAt,
  }));
}

export function normalizeUploadedAssets(assets) {
  const raw = Array.isArray(assets) ? assets : [];
  return raw.map((asset, index) => {
    const id = normalizeText(asset?.id) || `asset_${index + 1}`;
    const name = normalizeText(asset?.name) || `Asset ${index + 1}`;
    const type = normalizeText(asset?.type || asset?.mimeType) || 'application/octet-stream';
    const role = normalizeText(asset?.role) || inferAssetRole(type, name);
    return {
      id,
      name,
      type,
      role,
      path: normalizeText(asset?.path || asset?.filePath || asset?.localPath),
      previewDataUrl: String(asset?.previewDataUrl || asset?.dataUrl || '').trim(),
      size: Number.isFinite(Number(asset?.size)) ? Number(asset.size) : 0,
      width: Number.isFinite(Number(asset?.width)) ? Number(asset.width) : undefined,
      height: Number.isFinite(Number(asset?.height)) ? Number(asset.height) : undefined,
      createdAt: normalizeText(asset?.createdAt) || new Date().toISOString(),
    };
  });
}

function normalizeInitImage(image = {}) {
  const id = normalizeText(image.id);
  const batchId = normalizeText(image.batchId);
  const slideId = normalizeText(image.slideId);
  const kind = normalizeText(image.kind);
  const label = normalizeText(image.label);
  const prompt = normalizeText(image.prompt);
  const dataUrl = String(image.dataUrl || '').trim();
  const routeFamily = normalizeText(image.routeFamily || image.family);
  if (!id) throw new Error('Image id is required.');
  if (!batchId) throw new Error('Image batchId is required.');
  if (!slideId) throw new Error('Image slideId is required.');
  if (!['visual-cue', 'palette'].includes(kind)) throw new Error('Image kind must be visual-cue or palette.');
  if (!label) throw new Error('Image label is required.');
  if (!prompt) throw new Error('Image prompt is required.');
  if (!dataUrl.startsWith('data:image/')) throw new Error('Image dataUrl must be a data:image URL.');
  if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(dataUrl)) {
    throw new Error('Init image dataUrl must be a base64 PNG, JPEG, or WebP raster image.');
  }
  if (kind === 'visual-cue' && !INIT_ROUTE_FAMILIES.includes(routeFamily)) {
    throw new Error(`Visual cue routeFamily must be one of: ${INIT_ROUTE_FAMILIES.join(', ')}`);
  }
  const out = {
    id,
    batchId,
    slideId,
    kind,
    label,
    prompt,
    dataUrl,
    ...(routeFamily ? { routeFamily, routeFamilyLabel: INIT_ROUTE_FAMILY_LABELS[routeFamily] || routeFamily } : {}),
    createdAt: normalizeText(image.createdAt) || new Date().toISOString(),
  };
  if (kind === 'palette') {
    out.colors = normalizePaletteColors(image.colors);
    out.routeFamilies = normalizeRouteFamilyList(image.routeFamilies || image.routeFamily);
  }
  return out;
}

function normalizeInitTypographySet(fontSet = {}) {
  const id = normalizeText(fontSet.id);
  const batchId = normalizeText(fontSet.batchId);
  const slideId = normalizeText(fontSet.slideId);
  const kind = normalizeText(fontSet.kind);
  const label = normalizeText(fontSet.label);
  const rationale = normalizeText(fontSet.rationale);
  const cssUrl = normalizeFontCssUrl(fontSet.cssUrl || fontSet.googleFontsUrl || fontSet.fontCssUrl);
  if (!id) throw new Error('Typography id is required.');
  if (!batchId) throw new Error('Typography batchId is required.');
  if (!slideId) throw new Error('Typography slideId is required.');
  if (kind !== 'typography') throw new Error('Typography kind must be typography.');
  if (!label) throw new Error('Typography label is required.');
  if (!cssUrl) throw new Error('Typography cssUrl must be a Google Fonts CSS URL.');
  const heading = normalizeFontRole(fontSet.heading, 'heading');
  const body = normalizeFontRole(fontSet.body, 'body');
  return {
    id,
    batchId,
    slideId,
    kind,
    label,
    cssUrl,
    heading,
    body,
    sampleHeading: normalizeText(fontSet.sampleHeading) || 'A clearer first impression.',
    sampleBody: normalizeText(fontSet.sampleBody) || 'Use this pairing for product proof, brand language, buying decisions, and calm reassurance across the site.',
    rationale: rationale || `${heading.family} gives the brand a memorable heading voice while ${body.family} keeps longer copy readable.`,
    usage: normalizeText(fontSet.usage) || 'Use heading for display and section titles; use body for product education, proof, forms, and commerce copy.',
    avoid: normalizeText(fontSet.avoid) || '',
    createdAt: normalizeText(fontSet.createdAt) || new Date().toISOString(),
  };
}

function optionsForSlide(slide, context) {
  const patch = context.slidePatches?.[slide.id] || {};
  return normalizeOptions(patch.options || patch.suggestions || slide.options || []);
}

function normalizeOptions(value) {
  const raw = Array.isArray(value) ? value : [];
  return raw.map((item) => {
    if (item && typeof item === 'object') {
      const label = normalizeText(item.label || item.value);
      const answer = normalizeText(item.value || item.answer || item.label);
      const hint = normalizeText(item.hint || item.description);
      return label && answer ? { label, value: answer, ...(hint ? { hint } : {}) } : null;
    }
    const text = normalizeText(item);
    return text ? { label: text, value: text } : null;
  }).filter(Boolean).slice(0, 6);
}

function normalizePaletteColors(colors) {
  if (!Array.isArray(colors) || colors.length !== 4) {
    throw new Error('Palette images require exactly 4 colors.');
  }
  return colors.map((color, index) => {
    const name = normalizeText(color?.name) || `Color ${index + 1}`;
    const oklch = normalizeText(color?.oklch);
    if (!/^oklch\(/i.test(oklch)) {
      throw new Error('Palette color oklch values must use oklch(...).');
    }
    return { name, oklch };
  });
}

function normalizeRouteFamilyList(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(raw.map(normalizeText).filter((item) => INIT_ROUTE_FAMILIES.includes(item)))];
}

function normalizeFontRole(value = {}, role) {
  const family = normalizeText(value.family);
  if (!family) throw new Error(`Typography ${role}.family is required.`);
  return {
    family,
    weights: normalizeFontWeights(value.weights),
    style: normalizeText(value.style) || (role === 'heading' ? 'Display' : 'Body'),
    fallback: normalizeText(value.fallback) || (role === 'heading' ? 'serif' : 'sans-serif'),
  };
}

function normalizeFontWeights(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  const weights = [...new Set(raw
    .map((item) => Number.parseInt(String(item || '').trim(), 10))
    .filter((item) => Number.isFinite(item) && item >= 100 && item <= 900))];
  return weights.length > 0 ? weights : [400, 600];
}

function normalizeFontCssUrl(value) {
  const url = normalizeText(value);
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'fonts.googleapis.com') return '';
    if (!parsed.pathname.startsWith('/css')) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function imagesForIds(ids, images) {
  const byId = new Map(images.map((image) => [image.id, image]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

function typographyForIds(ids, typography = []) {
  const byId = new Map(typography.map((fontSet) => [fontSet.id, fontSet]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

function summarizeImageForAnswer(image) {
  if (!image) return null;
  return {
    id: image.id,
    batchId: image.batchId,
    slideId: image.slideId,
    kind: image.kind,
    label: image.label,
    prompt: summarizePromptText(image.prompt),
    routeFamily: image.routeFamily,
    ...(Array.isArray(image.colors) ? { colors: image.colors } : {}),
  };
}

function summarizeTypographyForAnswer(fontSet) {
  if (!fontSet) return null;
  return {
    id: fontSet.id,
    batchId: fontSet.batchId,
    slideId: fontSet.slideId,
    kind: fontSet.kind,
    label: fontSet.label,
    cssUrl: fontSet.cssUrl,
    heading: fontSet.heading,
    body: fontSet.body,
    rationale: fontSet.rationale,
    usage: fontSet.usage,
  };
}

function summarizePromptText(value, max = 1200) {
  const text = normalizeText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function inferAssetRole(type, name) {
  const lower = `${type} ${name}`.toLowerCase();
  if (lower.includes('gif') || lower.includes('video') || lower.includes('mp4')) return 'motion';
  if (lower.includes('testimonial') || lower.includes('review') || lower.endsWith('.txt') || lower.includes('text')) return 'proof';
  if (lower.includes('process')) return 'process';
  if (lower.includes('image') || lower.match(/\.(png|jpe?g|webp)$/)) return 'product-photo';
  return 'asset';
}

function normalizeIdList(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(raw.map((item) => String(item || '').trim()).filter(Boolean))];
}

function normalizeFreeform(value) {
  const text = normalizeText(value);
  return text || undefined;
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
