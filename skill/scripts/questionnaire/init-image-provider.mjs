import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const IMAGE_API_KEY_NAMES = [
  'IMAGE_API_KEY',
  'IMPECCABLE_IMAGE_API_KEY',
  'BFL_API_KEY',
  'FLUX_API_KEY',
];

export const FLUX_ENDPOINT = 'https://api.bfl.ai/v1/flux-2-pro-preview';
export const FLUX_MODEL = 'flux-2-pro-preview';
export const MISSING_IMAGE_API_KEY_ALERT = 'No IMAGE_API_KEY in .impeccable/.env. Using built-in images; Flux is faster.';
export const NO_TEXT_IMAGE_CONSTRAINT = 'Hard constraint: absolutely no readable or fake text anywhere. Do not write the brand name or any product name. No letters, words, numerals, signatures, maker marks, annotations, labels, captions, diagram ticks, microtype, pseudo-writing, watermark, logo, UI, website screen, packaging label, or text-like decoration. Keep every surface physically clean.';
export const FLUX_PROMPT_MAX_CHARS = 12000;

export function resolveImageProviderConfig({ cwd = process.cwd(), env = process.env } = {}) {
  const hit = findImageApiKey({ cwd, env });
  if (hit) {
    return {
      provider: 'flux',
      providerLabel: 'Flux Pro',
      endpoint: FLUX_ENDPOINT,
      model: FLUX_MODEL,
      apiKey: hit.value,
      keyName: hit.name,
      keySource: hit.source,
      hasKey: true,
    };
  }
  return {
    provider: 'builtin-quadrant',
    providerLabel: 'Built-in image generation',
    keyName: 'IMAGE_API_KEY',
    keySource: null,
    hasKey: false,
    alertMessage: MISSING_IMAGE_API_KEY_ALERT,
  };
}

export function publicImageProviderConfig(config = {}) {
  const provider = config.provider || 'builtin-quadrant';
  return {
    provider,
    providerLabel: config.providerLabel || (provider === 'flux' ? 'Flux Pro' : 'Built-in image generation'),
    model: provider === 'flux' ? (config.model || FLUX_MODEL) : 'codex-built-in-quadrant',
    hasKey: Boolean(config.hasKey),
    keyName: config.keyName || 'IMAGE_API_KEY',
    keySource: config.keySource ? safeKeySource(config.keySource) : null,
    ...(provider === 'builtin-quadrant' ? { alertMessage: config.alertMessage || MISSING_IMAGE_API_KEY_ALERT } : {}),
  };
}

export function redactImageProviderConfig(config = {}) {
  const out = { ...config };
  if (Object.prototype.hasOwnProperty.call(out, 'apiKey')) out.apiKey = '[redacted]';
  return out;
}

export function findImageApiKey({ cwd = process.cwd(), env = process.env } = {}) {
  for (const name of IMAGE_API_KEY_NAMES) {
    const value = normalizeSecret(env?.[name]);
    if (value) return { name, value, source: 'process.env' };
  }
  for (const envPath of [
    path.join(cwd, '.impeccable', '.env'),
    path.join(cwd, '.impeccable', 'env'),
  ]) {
    if (!fs.existsSync(envPath)) continue;
    const parsed = parseEnvFile(fs.readFileSync(envPath, 'utf-8'));
    for (const name of IMAGE_API_KEY_NAMES) {
      const value = normalizeSecret(parsed[name]);
      if (value) return { name, value, source: envPath };
    }
  }
  return null;
}

export function parseEnvFile(source = '') {
  const out = {};
  for (const rawLine of String(source || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
    const equals = normalized.indexOf('=');
    if (equals <= 0) continue;
    const key = normalized.slice(0, equals).trim();
    let value = normalized.slice(equals + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    out[key] = value;
  }
  return out;
}

export function decorateInitImageRequest(request, { imageProvider = null } = {}) {
  const provider = publicImageProviderConfig(imageProvider || {});
  const routes = buildInitImageRoutes(request);
  const decorated = {
    ...request,
    imageProvider: provider,
    imageRoutes: routes.map(publicRoute),
  };
  if (provider.provider === 'builtin-quadrant') {
    decorated.builtInQuadrant = buildBuiltInQuadrantRequest(request, { routes });
  } else {
    decorated.flux = {
      model: provider.model,
      endpoint: FLUX_ENDPOINT,
      prompts: routes.map((route) => ({
        id: route.id,
        label: route.label,
        routeFamily: route.routeFamily,
        prompt: buildFluxPrompt(request, route),
      })),
    };
  }
  return decorated;
}

export function buildInitImageRoutes(request = {}) {
  return (request.kind === 'palette' || request.slideId === 'palette')
    ? buildPaletteRoutes(request)
    : buildVisualCueRoutes(request);
}

export async function generateInitImageBatch(request, options = {}) {
  const cwd = options.cwd || process.cwd();
  const providerConfig = options.providerConfig || resolveImageProviderConfig({ cwd, env: options.env || process.env });
  if (providerConfig.provider !== 'flux') {
    throw new Error('Built-in quadrant generation requires an agent-generated sheet.');
  }
  return generateFluxParallelResponse({
    request,
    routes: options.routes || buildInitImageRoutes(request),
    apiKey: providerConfig.apiKey,
    cwd,
    fetchImpl: options.fetchImpl || fetch,
    artifactDir: options.artifactDir,
    pollIntervalMs: options.pollIntervalMs,
    timeoutMs: options.timeoutMs,
    minDimension: options.minDimension,
  });
}

export async function generateFluxParallelResponse({
  request,
  routes = buildInitImageRoutes(request),
  apiKey,
  cwd = process.cwd(),
  fetchImpl = fetch,
  artifactDir = null,
  pollIntervalMs = 500,
  timeoutMs = 120000,
  minDimension = 512,
  maxAttempts = 3,
  retryBaseDelayMs = 1000,
} = {}) {
  if (!apiKey) throw new Error('IMAGE_API_KEY is required for Flux image generation.');
  const startedAt = Date.now();
  const dir = artifactDir || imageArtifactDir(cwd, request);
  fs.mkdirSync(dir, { recursive: true });
  const images = await Promise.all(routes.map((route, index) => generateFluxRouteWithRetry({
    request,
    route,
    index,
    apiKey,
    fetchImpl,
    dir,
    pollIntervalMs,
    timeoutMs,
    minDimension,
    maxAttempts,
    retryBaseDelayMs,
  })));
  const completedAt = Date.now();
  return {
    provider: 'flux',
    model: FLUX_MODEL,
    slideId: request.slideId,
    batchId: request.batchId,
    images,
    metrics: {
      providerStartedAt: new Date(startedAt).toISOString(),
      providerCompletedAt: new Date(completedAt).toISOString(),
      providerDurationMs: completedAt - startedAt,
    },
  };
}

async function generateFluxRouteWithRetry({
  request,
  route,
  index,
  apiKey,
  fetchImpl,
  dir,
  pollIntervalMs,
  timeoutMs,
  minDimension,
  maxAttempts = 3,
  retryBaseDelayMs = 1000,
}) {
  let lastError = null;
  const attempts = Math.max(1, Number(maxAttempts) || 1);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const image = await generateFluxRoute({
        request,
        route,
        index,
        apiKey,
        fetchImpl,
        dir,
        pollIntervalMs,
        timeoutMs,
        minDimension,
      });
      return {
        ...image,
        generationAttempts: attempt,
      };
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      await delay(Math.min(retryBaseDelayMs * attempt, 3000));
    }
  }
  throw new Error(`Flux generation failed for ${route.label} after ${attempts} attempts: ${lastError?.message || 'unknown error'}`);
}

export function buildBuiltInQuadrantRequest(request = {}, { routes = buildInitImageRoutes(request) } = {}) {
  return {
    provider: 'builtin-quadrant',
    model: 'codex-built-in-image',
    alertMessage: MISSING_IMAGE_API_KEY_ALERT,
    sheetLayout: '2x2',
    prompt: buildQuadrantPrompt(request, routes),
    routes: routes.map((route, index) => ({
      index: index + 1,
      quadrant: ['top-left', 'top-right', 'bottom-left', 'bottom-right'][index],
      id: route.id,
      label: route.label,
      routeFamily: route.routeFamily,
      designTranslation: route.designTranslation,
    })),
  };
}

export async function cropBuiltInQuadrantSheet({
  request,
  sheetDataUrl = '',
  sheetPath = '',
  routes = buildInitImageRoutes(request),
  cwd = process.cwd(),
  artifactDir = null,
  cropper = null,
  minDimension = 1,
} = {}) {
  const dir = artifactDir || imageArtifactDir(cwd, request);
  fs.mkdirSync(dir, { recursive: true });
  const sourcePath = sheetPath
    ? path.resolve(cwd, sheetPath)
    : path.join(dir, 'quadrant-sheet.png');
  if (!sheetPath) {
    const parsed = dataUrlToBytes(sheetDataUrl);
    if (!parsed || parsed.mimeType !== 'image/png') throw new Error('image_sheet requires a PNG sheetDataUrl or sheetPath.');
    fs.writeFileSync(sourcePath, parsed.bytes);
  }

  const dimensions = readPngDimensions(fs.readFileSync(sourcePath));
  const cropWidth = Math.floor(dimensions.width / 2);
  const cropHeight = Math.floor(dimensions.height / 2);
  const positions = [
    { x: 0, y: 0 },
    { x: cropWidth, y: 0 },
    { x: 0, y: cropHeight },
    { x: cropWidth, y: cropHeight },
  ];

  const crop = cropper || cropWithImageMagick;
  const images = [];
  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];
    const outPath = path.join(dir, `${String(index + 1).padStart(2, '0')}-${route.id}.png`);
    await crop({
      sourcePath,
      outPath,
      width: cropWidth,
      height: cropHeight,
      x: positions[index].x,
      y: positions[index].y,
    });
    const bytes = fs.readFileSync(outPath);
    const outDimensions = validateImageBytes(bytes, { minDimension });
    images.push(imagePayloadFromBytes({
      request,
      route,
      index,
      bytes,
      filePath: outPath,
      dimensions: outDimensions,
      provider: 'builtin-quadrant',
    }));
  }
  return {
    provider: 'builtin-quadrant',
    model: 'codex-built-in-image',
    slideId: request.slideId,
    batchId: request.batchId,
    images,
    sheetPath: sourcePath,
  };
}

export function buildFluxPrompt(request = {}, route = {}) {
  const context = contextForPrompt(request);
  const brandBrief = brandBriefLines(context);
  const uploadedReferences = uploadedReferenceLines(context, route);
  const baselineRules = baselineImageRules(route, request);
  if (request.kind === 'palette' || request.slideId === 'palette') {
    return boundedPrompt([
      `1:1 full-bleed brand palette direction artifact, route ${route.index}: ${route.label}.`,
      'Purpose: help a real client choose a color world for a site identity after seeing selected visual cue cards. This is a designer presentation artifact, not decoration.',
      'Visibility rule: brand names, product names, user words, filenames, and audience phrases are briefing context only and must not appear visually.',
      '',
      'Brand brief:',
      ...brandBrief,
      '',
      'Selected cue inheritance:',
      ...(context.selectedCueLines.length > 0
        ? context.selectedCueLines
        : ['- No selected cue detail was available; inherit the current route families and prior answers.']),
      `- Selected route families: ${context.selectedRouteFamilies.join(', ') || 'not yet specified'}.`,
      '',
      'Uploaded reference manifest:',
      ...uploadedReferences,
      '',
      'Palette route:',
      `- Route family to inherit: ${route.routeFamily}.`,
      `- Strategic direction: ${context.userDirection || route.strategy}.`,
      `- Color thesis: ${route.subject}.`,
      `- Color-role logic: ${route.paletteMood}.`,
      `- Composition: ${route.composition}`,
      `- Lighting and finish: ${route.lighting}`,
      `- Design translation: ${route.designTranslation}`,
      '',
      'Execution brief:',
      '- Create one independent square color-world artifact with tactile color relationships, not a flat swatch sheet.',
      '- The browser renders color names and OKLCH swatches separately, so the image itself must contain no labels.',
      '- Show four deliberate color relationships through material, light, edge, field, depth, atmosphere, pattern, or editorial fragments.',
      ...baselineRules,
      NO_TEXT_IMAGE_CONSTRAINT,
    ]);
  }
  return boundedPrompt([
    `1:1 full-bleed brand identity visual cue card, route ${route.index}: ${route.label}.`,
    'Purpose: show one distinct art-direction door in a professional identity presentation. The image should help a client choose a visual language before logo/UI design.',
    'Visibility rule: brand names, product names, user words, filenames, and audience phrases are briefing context only and must not appear visually.',
    '',
    'Brand brief:',
    ...brandBrief,
    '',
    'Uploaded reference manifest:',
    ...uploadedReferences,
    '',
    'Art-direction route:',
    `- Route family: ${route.routeFamily}.`,
    `- Concept route: ${route.strategy}.`,
    `- Primary visual subject: ${route.subject}.`,
    `- Medium and visual language: ${route.visualLanguage}.`,
    `- Composition and framing: ${route.composition}`,
    `- Lighting and finish: ${route.lighting}`,
    `- Palette and mood: ${route.paletteMood}`,
    `- Design translation: ${route.designTranslation}`,
    '',
    'Execution brief:',
    '- Create one standalone card with one clear visual thesis, generous negative space, and no neighboring panels.',
    '- Make this route materially different from the other cards in motif, medium, value range, composition, and emotional register.',
    '- It can be physical, graphic, symbolic, playful, atmospheric, patterned, surreal, or editorial, but it must still imply future design behavior.',
    ...baselineRules,
    NO_TEXT_IMAGE_CONSTRAINT,
  ]);
}

export function buildQuadrantPrompt(request = {}, routes = buildInitImageRoutes(request)) {
  const context = contextForPrompt(request);
  const quadrantNames = ['Top-left', 'Top-right', 'Bottom-left', 'Bottom-right'];
  return [
    'Create ONE square 2x2 quadrant sheet for brand identity exploration. The final image will be cropped into four equal standalone square cards.',
    '',
    `Brand context: ${context.brandSummary}`,
    'Treat all brand names, product names, and audience words as hidden briefing context only. They must not appear visually.',
    `Direction: ${context.userDirection || 'first-round visual exploration from the product, brand, audience, and uploaded material.'}`,
    context.uploadedAssets.length > 0
      ? `Reference uploads: ${context.uploadedAssets.map((asset) => `Image ${asset.index}: ${asset.role || 'reference'} (${asset.name || asset.id})`).join('; ')}.`
      : 'Reference uploads: none.',
    '',
    'Required exact 2x2 layout:',
    ...routes.map((route, index) => `${quadrantNames[index]}: ${route.label}. ${route.subject}. ${route.strategy}. ${route.visualLanguage || route.paletteMood}. ${route.designTranslation}.`),
    '',
    'Composition: one square canvas divided into four equal square quadrants. Each quadrant must work after exact cropping as its own full-bleed art-direction study with one clear thesis.',
    'Keep quadrants visually distinct in route family, motif, material logic, value range, composition, and emotional register.',
    `${NO_TEXT_IMAGE_CONSTRAINT} No people. Opaque background. Controlled lighting, tactile surfaces, believable shadows, restrained color temperature.`,
  ].join('\n');
}

export function readPngDimensions(bytes) {
  const buffer = Buffer.from(bytes);
  const signature = '89504e470d0a1a0a';
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== signature) {
    throw new Error('Image must be a PNG.');
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

export function validateImageBytes(bytes, { minDimension = 512 } = {}) {
  const dimensions = readPngDimensions(bytes);
  if (dimensions.width < minDimension || dimensions.height < minDimension) {
    throw new Error(`Generated image must be at least ${minDimension}x${minDimension}.`);
  }
  return dimensions;
}

async function generateFluxRoute({ request, route, index, apiKey, fetchImpl, dir, pollIntervalMs, timeoutMs, minDimension }) {
  const prompt = buildFluxPrompt(request, route);
  const createRes = await fetchImpl(FLUX_ENDPOINT, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-key': apiKey,
    },
    body: JSON.stringify({
      prompt,
      width: 1024,
      height: 1024,
      prompt_upsampling: false,
      guidance: 7,
      output_format: 'png',
    }),
  });
  if (!createRes.ok) throw new Error(`Flux image request failed for ${route.label}.`);
  const createJson = await createRes.json();
  const pollingUrl = createJson.polling_url || createJson.pollingUrl;
  if (!pollingUrl) throw new Error('Flux response did not include polling_url.');
  const ready = await pollFluxResult({
    pollingUrl,
    fetchImpl,
    apiKey,
    pollIntervalMs,
    timeoutMs,
    route,
  });
  const sampleUrl = ready?.result?.sample || ready?.sample;
  if (!sampleUrl) throw new Error(`Flux result for ${route.label} did not include result.sample.`);
  const sampleRes = await fetchImpl(sampleUrl);
  if (!sampleRes.ok) throw new Error(`Could not download Flux image for ${route.label}.`);
  const bytes = Buffer.from(await sampleRes.arrayBuffer());
  const dimensions = validateImageBytes(bytes, { minDimension });
  const filePath = path.join(dir, `${String(index + 1).padStart(2, '0')}-${route.id}.png`);
  fs.writeFileSync(filePath, bytes);
  return imagePayloadFromBytes({ request, route, index, bytes, filePath, dimensions, provider: 'flux', prompt });
}

async function pollFluxResult({ pollingUrl, fetchImpl, apiKey, pollIntervalMs, timeoutMs, route }) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetchImpl(pollingUrl, {
      headers: {
        accept: 'application/json',
        'x-key': apiKey,
      },
    });
    if (!res.ok) throw new Error(`Flux polling failed for ${route.label}.`);
    const json = await res.json();
    const status = String(json.status || '').toLowerCase();
    if (status === 'ready') return json;
    if (status === 'error' || status === 'failed') {
      throw new Error(`Flux generation failed for ${route.label}.`);
    }
    await delay(pollIntervalMs);
  }
  throw new Error(`Flux generation timed out for ${route.label}.`);
}

async function cropWithImageMagick({ sourcePath, outPath, width, height, x, y }) {
  const binary = findImageMagickBinary();
  if (!binary) throw new Error('ImageMagick is required to crop built-in quadrant sheets.');
  const args = binary.endsWith('magick')
    ? [sourcePath, '-crop', `${width}x${height}+${x}+${y}`, '+repage', outPath]
    : [sourcePath, '-crop', `${width}x${height}+${x}+${y}`, '+repage', outPath];
  await execFileAsync(binary, args);
}

function findImageMagickBinary() {
  for (const candidate of [
    '/opt/homebrew/bin/magick',
    '/usr/local/bin/magick',
    '/usr/bin/magick',
    '/opt/homebrew/bin/convert',
    '/usr/local/bin/convert',
    '/usr/bin/convert',
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function buildVisualCueRoutes(request) {
  const context = contextForPrompt(request);
  const direction = context.userDirection;
  const focus = compactContextPhrase(context);
  const audience = context.audience || 'the first audience';
  const avoid = context.anti || 'category clichés';
  const proof = context.trust || context.differentiator || 'the brand promise';
  const isExploratoryReroll = /more|another|different|playful|abstract|graphic|surreal|pattern|character|joy|bounce|rubber|geometry|less/i.test(direction);
  if (isExploratoryReroll) {
    return [
      {
        index: 1,
        id: 'cue_playful_companion',
        label: 'Playful companion',
        routeFamily: 'playful-character',
        subject: `A charming non-literal companion form for this brief: ${focus}. Suggest care, comfort, fit, or protection through an expressive object-like presence, never a mascot with a face or logo.`,
        strategy: direction || `Make ${proof} feel approachable for ${audience}; avoid ${avoid}.`,
        visualLanguage: 'art-directed sculptural character object, toy-like proportion, premium matte material, no face, no costume, no cartoon outline',
        composition: 'single small companion form with generous space, low angle or table-level view, clear silhouette, full-bleed square',
        lighting: 'soft directional studio light with a small playful highlight, grounded shadow, clean material read',
        paletteMood: 'fresh light ground, one joyful accent, softened support tones, enough depth to stay credible',
        designTranslation: 'empty-state personality, micro-interaction timing, rounded icon language, gentle validation states',
      },
      {
        index: 2,
        id: 'cue_pattern_rhythm',
        label: 'Rhythm system',
        routeFamily: 'pattern-ornament',
        subject: `A repeatable rhythm cue from the brief: ${focus}. Turn the product benefit into spacing, repeat, border, tread, stitch, paw, wave, or protection logic without literal branding.`,
        strategy: direction || `Turn the differentiator into a usable system for ${audience}; avoid ${avoid}.`,
        visualLanguage: 'refined pattern fragment, tactile printed or embossed surface, large-scale repeat, imperfect human cadence, not wallpaper',
        composition: 'cropped pattern field with one strong interruption or edge, clear hierarchy, negative space, full-bleed square',
        lighting: 'raking light that reveals relief and texture, calm shadow, no busy sparkle',
        paletteMood: 'clean base, softened accent, muted support, one deeper anchoring tone',
        designTranslation: 'section dividers, focus rings, icon grids, background registration field, card rhythm',
      },
      {
        index: 3,
        id: 'cue_care_atmosphere',
        label: 'Care atmosphere',
        routeFamily: 'atmosphere-light',
        subject: `An atmospheric light cue for this brief: ${focus}. Show reassurance through glow, reflection, veil, temperature, or depth rather than literal product objects.`,
        strategy: direction || `Make ${proof} feel immediate and calm for ${audience}; avoid ${avoid}.`,
        visualLanguage: 'abstract light-and-surface study, controlled reflection, soft veil, clear edge behavior, no foggy generic blur',
        composition: 'large quiet field with one luminous crossing or protected zone, full-bleed square, restrained depth',
        lighting: 'diffused side light with a gentle color shift, controlled falloff, believable surface interaction',
        paletteMood: 'fresh clean light, human warmth, cooler support, readable depth',
        designTranslation: 'hero atmosphere, hover washes, loading states, modal backdrops, soft confirmation feedback',
      },
      {
        index: 4,
        id: 'cue_surreal_shelter',
        label: 'Surreal shelter',
        routeFamily: 'surreal-metaphor',
        subject: `A surreal-but-useful metaphor cue for this brand's emotional job: ${focus}. Create an impossible shelter, softened armor, tiny protected world, or symbolic care object that makes ${proof} memorable.`,
        strategy: direction || `Give the brand a distinctive world while staying useful and credible for ${audience}; avoid ${avoid}.`,
        visualLanguage: 'dreamlike editorial set piece, sculptural object, controlled surrealism, tactile realism, deep negative space',
        composition: 'single impossible object, grounded shadow, quiet surrounding field, square crop',
        lighting: 'museum-like controlled light, soft glow from one side, deep but readable shadows',
        paletteMood: 'deep atmospheric ground, mineral highlights, a gentle luminous accent',
        designTranslation: 'hero scene logic, modal depth, empty-state imagery, softened overlays, memorable campaign visuals',
      },
    ];
  }
  return [
    {
      index: 1,
      id: 'cue_protective_fold',
      label: 'Protective fold',
      routeFamily: 'material-object',
      subject: `A protective material cue for this exact brief: ${focus}. Translate the product promise into a sheltering edge, soft barrier, or fit-like fold without showing labels or UI.`,
      strategy: direction || `Make ${proof} feel tangible for ${audience}; avoid ${avoid}.`,
      visualLanguage: 'macro material photograph, tactile surface, one clear fold, generous negative space, refined product-photography realism',
      composition: 'solitary folded surface, close macro crop, quiet asymmetry, full-bleed square, no collage',
      lighting: 'controlled soft studio side light, believable contact shadow, satin highlights, visible fiber texture',
      paletteMood: 'warm neutral ground, mineral shadow, one deep verdigris or green-black accent if useful',
      designTranslation: 'layered sections, protective disclosure panels, quiet dividers, softened reveal motion',
    },
    {
      index: 2,
      id: 'cue_signal_geometry',
      label: 'Signal geometry',
      routeFamily: 'graphic-shape',
      subject: `A graphic system cue drawn from the brief: ${focus}. Use abstract rhythm, proportion, and spatial logic to imply the product's fit, safety, speed, or care without becoming a logo or interface.`,
      strategy: direction || `Turn the differentiator into spacing, marks, and focus logic for ${audience}; avoid ${avoid}.`,
      visualLanguage: 'editorial abstract composition, pure geometry, controlled negative space, printed ink edge, no literal product, no tiny symbols, no fine annotation marks',
      composition: 'large simple shapes with a few generous non-glyph dots or arcs, strong crop, one visible hierarchy, not a pattern sheet, no diagram labels, no small writing-like marks',
      lighting: 'flat-but-rich art-board lighting with subtle paper depth and ink density',
      paletteMood: 'restrained ground with one confident signal color and softened secondary marks',
      designTranslation: 'icon rhythm, section spacing, focus states, abstract composition logic, navigation accents',
    },
    {
      index: 3,
      id: 'cue_soft_reveal_arc',
      label: 'Soft reveal arc',
      routeFamily: 'gesture-motion',
      subject: `A gesture cue for the user's before-and-after moment in this brief: ${focus}. Show a sweep, bounce, trail, reveal, compression, or acceptance rhythm that makes the product benefit feel physical.`,
      strategy: direction || `Make the interaction feel guided and reassuring for ${audience}; avoid ${avoid}.`,
      visualLanguage: 'abstract motion study, one gesture path, tactile trail, crisp leading edge, atmospheric but legible',
      composition: 'diagonal or orbital sweep through quiet space, one clear gesture, full-bleed square',
      lighting: 'soft directional light with controlled gradient falloff, believable surface interaction',
      paletteMood: 'warm light against quieter ground, slightly deeper trailing shadow, no neon glow',
      designTranslation: 'scroll reveals, hover wash, carousel timing, loading feedback, page transitions',
    },
    {
      index: 4,
      id: 'cue_editorial_world',
      label: 'Editorial world',
      routeFamily: 'editorial-cultural',
      subject: `An editorial art-direction cue for this exact brief: ${focus}. Present a curated set-like fragment, cultural reference, or publication-quality visual world that makes ${proof} feel distinctive without becoming a moodboard collage.`,
      strategy: direction || `Make the brand feel considered and ownable for ${audience}; avoid ${avoid}.`,
      visualLanguage: 'publication-quality art-directed set, one hero material or object relationship, cultural but not referentially copied, premium editorial restraint',
      composition: 'single curated scene fragment, decisive crop, one focal relationship, strong negative space, no collage',
      lighting: 'controlled editorial studio light, crisp contact shadows, measured contrast, believable surface detail',
      paletteMood: 'specific brand temperature, one memorable accent, grounded support tone, readable depth',
      designTranslation: 'image direction, campaign crops, section composition, proof modules, art-directed product storytelling',
    },
  ];
}

function buildPaletteRoutes(request) {
  const context = contextForPrompt(request);
  const selectedFamilies = [...new Set((request.selectedImages || [])
    .map((image) => image.routeFamily)
    .filter(Boolean))];
  const familyLine = selectedFamilies.length > 0 ? selectedFamilies.join(', ') : 'selected cue route families';
  return [
    {
      index: 1,
      id: 'palette_ground_signal',
      label: 'Ground + signal',
      routeFamily: selectedFamilies[0] || 'material-object',
      subject: `A color-world artifact for ${compactContextPhrase(context)} that translates ${familyLine} into a grounded base with one memorable signal color.`,
      strategy: context.userDirection || `Quiet ground, confident action color, and honest product warmth shaped by ${context.trust || context.differentiator || 'the core promise'}.`,
      composition: 'square color-material study with one dominant ground, one signal accent, and two supporting depths',
      lighting: 'color-accurate studio light, no theatrical bloom',
      paletteMood: 'warm-to-neutral ground, vivid but restrained signal, deep contrast anchor',
      designTranslation: 'page ground, primary action, support surfaces, and depth color roles',
      colors: [
        { name: `${context.roleNoun} Ground`, oklch: 'oklch(91% 0.018 86)' },
        { name: 'Fit Signal', oklch: 'oklch(75% 0.135 76)' },
        { name: 'Soft Proof', oklch: 'oklch(63% 0.045 118)' },
        { name: 'Trust Depth', oklch: 'oklch(22% 0.025 88)' },
      ],
    },
    {
      index: 2,
      id: 'palette_luminous_care',
      label: 'Luminous care',
      routeFamily: selectedFamilies[1] || 'atmosphere-light',
      subject: `A luminous palette artifact for ${compactContextPhrase(context)} that keeps the selected cues soft, legible, and emotionally warm.`,
      strategy: context.userDirection || `A more atmospheric direction with usable contrast, soft surface relationships, and clear reassurance for ${context.audience || 'the first audience'}.`,
      composition: 'full-bleed light and material board, four clear color relationships, calm hierarchy',
      lighting: 'diffused light, soft shadow gradient, gentle highlight discipline',
      paletteMood: 'light surface, warm care tone, cool support, dark readable ink',
      designTranslation: 'hero atmosphere, cards, focus states, quiet dividers',
      colors: [
        { name: 'Clean Base', oklch: 'oklch(94% 0.012 205)' },
        { name: 'Care Glow', oklch: 'oklch(78% 0.095 74)' },
        { name: `${context.roleNoun} Proof`, oklch: 'oklch(67% 0.055 188)' },
        { name: 'Claim Ink', oklch: 'oklch(25% 0.022 238)' },
      ],
    },
    {
      index: 3,
      id: 'palette_editorial_contrast',
      label: 'Editorial contrast',
      routeFamily: selectedFamilies[2] || 'editorial-cultural',
      subject: `An editorial color board for ${compactContextPhrase(context)} that turns ${familyLine} into sharper contrast and cultural confidence.`,
      strategy: context.userDirection || `A composed, art-directed route that still works for a real site and avoids ${context.anti || 'category clichés'}.`,
      composition: 'precise cropped fields, tactile fragments, negative space, strong value contrast',
      lighting: 'clean directional light, crisp edges, no busy collage',
      paletteMood: 'off-white or dark ink field, one cultural accent, one support color, one depth color',
      designTranslation: 'section rhythm, editorial modules, typographic emphasis, proof blocks',
      colors: [
        { name: 'Page Field', oklch: 'oklch(90% 0.008 100)' },
        { name: `${context.roleNoun} Mark`, oklch: 'oklch(62% 0.16 34)' },
        { name: 'Support Tone', oklch: 'oklch(55% 0.07 210)' },
        { name: 'Type Depth', oklch: 'oklch(17% 0.012 92)' },
      ],
    },
    {
      index: 4,
      id: 'palette_deep_atmosphere',
      label: 'Deep atmosphere',
      routeFamily: selectedFamilies[3] || selectedFamilies[0] || 'surreal-metaphor',
      subject: `A deep atmospheric palette artifact for ${compactContextPhrase(context)} that gives the selected cues a memorable world without losing trust.`,
      strategy: context.userDirection || `A darker, richer route for depth, restraint, clear UI contrast, and ${context.trust || 'trust'}.`,
      composition: 'square atmospheric board, deep field, controlled highlights, clear four-color logic',
      lighting: 'low controlled light with readable edge highlights',
      paletteMood: 'deep ground, luminous accent, mineral support, soft text surface',
      designTranslation: 'dark hero, overlays, modal depth, interaction glow, contrast-safe surfaces',
      colors: [
        { name: 'Deep Field', oklch: 'oklch(14% 0.018 118)' },
        { name: 'Cue Light', oklch: 'oklch(78% 0.125 84)' },
        { name: 'Mineral Support', oklch: 'oklch(54% 0.058 168)' },
        { name: 'Soft Text', oklch: 'oklch(88% 0.012 94)' },
      ],
    },
  ];
}

function contextForPrompt(request = {}) {
  const answers = request.answers || {};
  const promptContext = request.promptContext || {};
  const product = promptContext.product || answerText(answers['product-overview']) || answerText(answers['project-identity']) || '';
  const differentiator = promptContext.differentiator || answerText(answers.differentiator) || '';
  const trust = promptContext.trust || answerText(answers.trust) || '';
  const audience = promptContext.audienceFit || promptContext.audience || answerText(answers['audience-fit']) || '';
  const anti = promptContext.antiAudience || answerText(answers['anti-audience']) || '';
  const userDirection = request.freeform || promptContext.userDirection || '';
  const uploadedAssets = Array.isArray(promptContext.uploadedAssets)
    ? promptContext.uploadedAssets
    : Array.isArray(request.uploadedAssets) ? request.uploadedAssets.map((asset, index) => ({ index: index + 1, ...asset })) : [];
  const selectedCueImages = Array.isArray(promptContext.selectedCueImages)
    ? promptContext.selectedCueImages
    : Array.isArray(request.selectedImages) ? request.selectedImages : [];
  const selectedRouteFamilies = [...new Set(selectedCueImages
    .flatMap((image) => [
      image.routeFamily,
      ...(Array.isArray(image.routeFamilies) ? image.routeFamilies : []),
    ])
    .filter(Boolean))];
  const brandName = promptContext.brandName || inferBrandName(product);
  const roleNoun = inferRoleNoun({ product, trust, audience });
  const selectedCueLines = selectedCueImages.map((image, index) => [
    `- Cue ${index + 1}: ${image.label || image.id}`,
    `routeFamily=${image.routeFamily || (Array.isArray(image.routeFamilies) ? image.routeFamilies.join('+') : 'unknown')}`,
    image.prompt ? `source prompt summary=${truncateForPrompt(image.prompt, 700)}` : '',
  ].filter(Boolean).join('; '));
  return {
    brandName,
    roleNoun,
    product,
    differentiator,
    trust,
    audience,
    anti,
    userDirection,
    uploadedAssets,
    selectedCueImages,
    selectedRouteFamilies,
    selectedCueLines,
    brandSummary: [
      brandName && `Brand: ${brandName}`,
      product && `Product: ${product}`,
      differentiator && `Differentiator: ${differentiator}`,
      trust && `Trust: ${trust}`,
      audience && `Audience: ${audience}`,
      anti && `Avoid: ${anti}`,
    ].filter(Boolean).join('. ') || 'Early-stage brand/site direction.',
    selectedCueSummary: selectedCueImages.map((image) => [
      `${image.label || image.id} (${image.routeFamily || 'cue'})`,
      image.prompt ? `source prompt: ${truncateForPrompt(image.prompt, 260)}` : '',
    ].filter(Boolean).join(' - ')).join('; '),
  };
}

function brandBriefLines(context = {}) {
  const lines = [
    context.brandName && `- Brand name: ${context.brandName}`,
    context.product && `- Product/site definition: ${context.product}`,
    context.differentiator && `- Differentiator: ${context.differentiator}`,
    context.trust && `- Trust answer: ${context.trust}`,
    context.audience && `- Audience answer: ${context.audience}`,
    context.anti && `- Anti-audience / avoid answer: ${context.anti}`,
    context.userDirection && `- User direction for this generation: ${context.userDirection}`,
  ].filter(Boolean);
  return lines.length > 0 ? lines : ['- Early-stage brand/site direction; infer from route only.'];
}

function uploadedReferenceLines(context = {}, route = {}) {
  if (!Array.isArray(context.uploadedAssets) || context.uploadedAssets.length === 0) {
    return ['- No uploaded assets provided.'];
  }
  return context.uploadedAssets.map((asset, index) => [
    `- Image ${asset.index || index + 1}: ${asset.role || 'reference'} (${asset.name || asset.id || 'unnamed upload'})`,
    asset.width && asset.height ? `${asset.width}x${asset.height}` : '',
    `influence=${assetInfluenceFor(route, asset)}`,
  ].filter(Boolean).join('; '));
}

function baselineImageRules(route = {}, request = {}) {
  const isPalette = request.kind === 'palette' || request.slideId === 'palette';
  return [
    '- Baseline: independent 1:1 square card, opaque background, full-bleed image, no contact sheet, no montage, no UI mockup.',
    `- Route diversity: this card must read as ${route.routeFamily || 'its route family'}, not as a generic material still life.`,
    isPalette
      ? '- Palette baseline: color relationships should be visible through a designed artifact; browser UI handles the swatches.'
      : '- Visual cue baseline: one strategic motif that could become design language, not a finished logo or product ad.',
  ];
}

function boundedPrompt(lines) {
  const prompt = lines.filter((line) => line !== null && line !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (prompt.length <= FLUX_PROMPT_MAX_CHARS) return prompt;
  return `${prompt.slice(0, FLUX_PROMPT_MAX_CHARS - 120).trim()}\n\n[Prompt intentionally truncated to keep session payload bounded; preserve all constraints above.]`;
}

function answerText(answer) {
  if (!answer || typeof answer !== 'object') return '';
  for (const candidate of [answer.freeform, answer.value, answer.label]) {
    if (Array.isArray(candidate)) continue;
    const text = String(candidate || '').trim();
    if (!text) continue;
    if (/^(recommended|route\s+\d+|option\s+\d+)$/i.test(text)) continue;
    return text;
  }
  return '';
}

function compactContextPhrase(context = {}) {
  return truncateForPrompt([
    context.product && `product ${context.product}`,
    context.differentiator && `differentiator ${context.differentiator}`,
    context.trust && `trust ${context.trust}`,
    context.audience && `audience ${context.audience}`,
    context.anti && `avoid ${context.anti}`,
  ].filter(Boolean).join('; ') || 'the current brand brief', 520);
}

function truncateForPrompt(value, max = 240) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function inferBrandName(product = '') {
  const text = String(product || '').trim();
  const match = text.match(/^([A-Z][A-Za-z0-9'&.-]*(?:\s+[A-Z][A-Za-z0-9'&.-]*){0,3})\s+(?:is|makes|offers|creates|builds|sells)\b/);
  return match ? match[1].trim() : '';
}

function inferRoleNoun({ product = '', trust = '', audience = '' } = {}) {
  const text = `${product} ${trust} ${audience}`.toLowerCase();
  if (/puppy|paw|dog/.test(text)) return 'Paw';
  if (/cream|skin|hand|barrier/.test(text)) return 'Care';
  if (/deodorant|deo|odor|fresh/.test(text)) return 'Fresh';
  if (/message|chat|private|reply/.test(text)) return 'Signal';
  if (/flower|bouquet|florist|seasonal/.test(text)) return 'Bloom';
  return 'Brand';
}

function imageArtifactDir(cwd, request = {}) {
  return path.join(
    cwd,
    '.impeccable',
    'init',
    'generated',
    request.sessionId || 'session',
    'providers',
    request.batchId || `batch-${Date.now().toString(36)}`,
  );
}

function imagePayloadFromBytes({ request, route, index, bytes, filePath, dimensions, provider, prompt = null }) {
  return {
    id: route.id,
    batchId: request.batchId,
    slideId: request.slideId,
    kind: request.kind || (request.slideId === 'palette' ? 'palette' : 'visual-cue'),
    label: route.label,
    prompt: prompt || buildFluxPrompt(request, route),
    dataUrl: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`,
    routeFamily: request.slideId === 'palette' ? undefined : route.routeFamily,
    routeFamilies: request.slideId === 'palette' ? [route.routeFamily].filter(Boolean) : undefined,
    colors: request.slideId === 'palette' ? route.colors : undefined,
    provider,
    localPath: filePath.split(path.sep).join('/'),
    width: dimensions.width,
    height: dimensions.height,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function dataUrlToBytes(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+);base64,(.+)$/s);
  if (!match) return null;
  return {
    mimeType: match[1].toLowerCase(),
    bytes: Buffer.from(match[2], 'base64'),
  };
}

function publicRoute(route) {
  return {
    id: route.id,
    label: route.label,
    routeFamily: route.routeFamily,
    subject: route.subject,
    strategy: route.strategy,
    designTranslation: route.designTranslation,
  };
}

function assetInfluenceFor(route, asset = {}) {
  if (String(asset.role || '').includes('product')) return `surface, scale, material honesty, and color temperature for ${route.label}`;
  if (String(asset.role || '').includes('testimonial')) return `trust tone and proof context for ${route.label}`;
  if (String(asset.role || '').includes('process')) return `making evidence and texture logic for ${route.label}`;
  return `useful color, texture, and composition signals for ${route.label}`;
}

function safeKeySource(source) {
  if (source === 'process.env') return source;
  return source.split(path.sep).slice(-2).join('/');
}

function normalizeSecret(value) {
  const text = String(value || '').trim();
  return text && !/^(['"])?\1$/.test(text) ? text : '';
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}
