import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import {
  buildBuiltInQuadrantRequest,
  buildFluxPrompt,
  buildInitImageRoutes,
  cropBuiltInQuadrantSheet,
  decorateInitImageRequest,
  FLUX_ENDPOINT,
  generateFluxParallelResponse,
  MISSING_IMAGE_API_KEY_ALERT,
  NO_TEXT_IMAGE_CONSTRAINT,
  publicImageProviderConfig,
  redactImageProviderConfig,
  resolveImageProviderConfig,
} from '../skill/scripts/questionnaire/init-image-provider.mjs';

let scratch;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-init-image-provider-'));
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('init image provider config', () => {
  it('loads IMAGE_API_KEY from .impeccable/.env and keeps public config redacted', () => {
    fs.mkdirSync(path.join(scratch, '.impeccable'), { recursive: true });
    fs.writeFileSync(path.join(scratch, '.impeccable', '.env'), [
      '# local image provider',
      'IMAGE_API_KEY="bfl_local_secret"',
      '',
    ].join('\n'));

    const config = resolveImageProviderConfig({ cwd: scratch, env: {} });
    assert.equal(config.provider, 'flux');
    assert.equal(config.keyName, 'IMAGE_API_KEY');
    assert.equal(config.apiKey, 'bfl_local_secret');
    assert.equal(config.keySource, path.join(scratch, '.impeccable', '.env'));

    assert.equal(publicImageProviderConfig(config).provider, 'flux');
    assert.equal(publicImageProviderConfig(config).apiKey, undefined);
    assert.equal(redactImageProviderConfig(config).apiKey, '[redacted]');
    assert.doesNotMatch(JSON.stringify(publicImageProviderConfig(config)), /bfl_local_secret/);
  });

  it('supports compatibility aliases and process env priority', () => {
    fs.mkdirSync(path.join(scratch, '.impeccable'), { recursive: true });
    fs.writeFileSync(path.join(scratch, '.impeccable', 'env'), 'FLUX_API_KEY=file_secret\n');

    const config = resolveImageProviderConfig({
      cwd: scratch,
      env: { BFL_API_KEY: 'process_secret' },
    });

    assert.equal(config.provider, 'flux');
    assert.equal(config.keyName, 'BFL_API_KEY');
    assert.equal(config.keySource, 'process.env');
    assert.equal(config.apiKey, 'process_secret');
  });

  it('uses the built-in quadrant fallback when no key exists', () => {
    const config = resolveImageProviderConfig({ cwd: scratch, env: {} });

    assert.equal(config.provider, 'builtin-quadrant');
    assert.equal(config.hasKey, false);
    assert.equal(config.alertMessage, MISSING_IMAGE_API_KEY_ALERT);
    assert.equal(publicImageProviderConfig(config).alertMessage, MISSING_IMAGE_API_KEY_ALERT);
  });
});

describe('init image prompts and fallback payloads', () => {
  it('decorates no-key requests with strict 2x2 quadrant instructions and route labels', () => {
    const request = sampleRequest({ freeform: 'More abstract and playful, less ceramic still life.' });
    const decorated = decorateInitImageRequest(request, {
      imageProvider: publicImageProviderConfig(resolveImageProviderConfig({ cwd: scratch, env: {} })),
    });

    assert.equal(decorated.imageProvider.provider, 'builtin-quadrant');
    assert.match(decorated.builtInQuadrant.prompt, /Create ONE square 2x2 quadrant sheet/);
    assert.match(decorated.builtInQuadrant.prompt, /Top-left: Playful companion/);
    assert.match(decorated.builtInQuadrant.prompt, /Top-right: Rhythm system/);
    assert.match(decorated.builtInQuadrant.prompt, /Bottom-left: Care atmosphere/);
    assert.match(decorated.builtInQuadrant.prompt, /Bottom-right: Surreal shelter/);
    assert.match(decorated.builtInQuadrant.prompt, /hidden briefing context only/);
    assert.match(decorated.builtInQuadrant.prompt, /absolutely no readable or fake text anywhere/);
    assert.match(decorated.builtInQuadrant.prompt, /microtype, pseudo-writing/);
    assert.doesNotMatch(decorated.builtInQuadrant.prompt, /diagrams, navigation/);
  });

  it('keeps Flux prompts independent, route-diverse, and not contact-sheet based', () => {
    const request = sampleRequest();
    const routes = buildInitImageRoutes(request);
    const families = new Set(routes.map((route) => route.routeFamily));
    const prompts = routes.map((route) => buildFluxPrompt(request, route));

    assert.equal(routes.length, 4);
    assert.ok(families.size >= 3);
    for (const prompt of prompts) {
      assert.match(prompt, /1:1 full-bleed/);
      assert.match(prompt, /standalone/);
      assert.match(prompt, /Brand brief:/);
      assert.match(prompt, /Design translation:/);
      assert.match(prompt, /Uploaded reference manifest:/);
      assert.match(prompt, /Product\/site definition:/);
      assert.match(prompt, /Differentiator:/);
      assert.match(prompt, /Trust answer:/);
      assert.match(prompt, /Audience answer:/);
      assert.match(prompt, /Anti-audience \/ avoid answer:/);
      assert.match(prompt, /Baseline: independent 1:1 square card/);
      assert.match(prompt, new RegExp(NO_TEXT_IMAGE_CONSTRAINT.slice(0, 48).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.match(prompt, /Do not write the brand name or any product name/);
      assert.match(prompt, /No letters, words, numerals, signatures, maker marks, annotations/);
      assert.doesNotMatch(prompt, /Create ONE square 2x2|Required exact 2x2|quadrant sheet/i);
      assert.ok(prompt.length <= 12000, 'Flux prompt should stay bounded for session payloads');
    }
  });

  it('passes full Puppy context into visual cue Flux prompts', () => {
    const request = puppyRequest({
      freeform: 'More playful but still premium. Add bounce, tiny paw geometry, soft rubber, and one charming character-like cue.',
    });
    const routes = buildInitImageRoutes(request);
    const families = new Set(routes.map((route) => route.routeFamily));
    const prompts = routes.map((route) => buildFluxPrompt(request, route));
    const combined = prompts.join('\n\n---\n\n');

    assert.equal(routes.length, 4);
    assert.ok(families.size >= 3);
    assert.match(combined, /Brand name: Puppy Wear/);
    assert.match(combined, /soft protective puppy shoes for tiny paws/);
    assert.match(combined, /light, flexible, and washable/);
    assert.match(combined, /Gentle paw protection/);
    assert.match(combined, /New puppy owners/);
    assert.match(combined, /Not for costume fashion/);
    assert.match(combined, /More playful but still premium/);
    assert.match(combined, /Image 1: product-context \(puppy-walking\.png\)/);
    assert.match(combined, /Image 2: material-reference \(tiny-shoe-detail\.png\)/);
    assert.match(combined, /Image 3: review \(puppy-parent-review\.png\)/);
    assert.match(combined, /spacing, edge, surface|Design translation:/);
    assert.doesNotMatch(combined, /Create ONE square 2x2|Required exact 2x2|quadrant sheet/i);
    assert.ok(prompts.every((prompt) => prompt.length <= 12000));
  });

  it('crops a built-in quadrant sheet into four browser card payloads', async () => {
    const request = sampleRequest({ batchId: 'cue_batch_sheet' });
    const result = await cropBuiltInQuadrantSheet({
      request,
      cwd: scratch,
      sheetDataUrl: pngDataUrl({ width: 64, height: 64, seed: 1 }),
      cropper: async ({ outPath, x, y }) => {
        fs.writeFileSync(outPath, pngBytes({ width: 32, height: 32, seed: x + y + 7 }));
      },
      minDimension: 1,
    });

    assert.equal(result.provider, 'builtin-quadrant');
    assert.equal(result.images.length, 4);
    assert.equal(result.images[0].batchId, 'cue_batch_sheet');
    assert.ok(new Set(result.images.map((image) => image.routeFamily)).size >= 3);
    assert.ok(result.images.every((image) => image.dataUrl.startsWith('data:image/png;base64,')));
  });

  it('builds palette routes with exactly four OKLCH colors each', () => {
    const request = {
      ...sampleRequest({ slideId: 'palette', kind: 'palette', batchId: 'palette_batch' }),
      selectedImages: [
        { id: 'cue_material', label: 'Thrown clay', routeFamily: 'material-object' },
        { id: 'cue_motion', label: 'Light sweep', routeFamily: 'gesture-motion' },
      ],
    };

    const quadrant = buildBuiltInQuadrantRequest(request);
    const routes = buildInitImageRoutes(request);

    assert.match(quadrant.prompt, /Create ONE square 2x2 quadrant sheet/);
    assert.equal(routes.length, 4);
    for (const route of routes) {
      assert.equal(route.colors.length, 4);
      assert.ok(route.colors.every((color) => /^oklch\(/.test(color.oklch)));
    }
  });

  it('passes selected cue context into palette Flux prompts', () => {
    const request = puppyRequest({
      slideId: 'palette',
      kind: 'palette',
      batchId: 'palette_batch_puppy',
      freeform: 'More joyful and clean. Keep trust, but avoid baby-blue pet-store clichés.',
      selectedImages: [
        {
          id: 'cue_playful_companion',
          label: 'Playful companion',
          routeFamily: 'playful-character',
          prompt: '1:1 full-bleed brand identity visual cue card. Product/site definition: Puppy Wear makes soft protective puppy shoes. Design translation: rounded icon language and gentle validation states.',
        },
        {
          id: 'cue_pattern_rhythm',
          label: 'Rhythm system',
          routeFamily: 'pattern-ornament',
          prompt: '1:1 full-bleed brand identity visual cue card. Primary visual subject: tiny paw geometry, soft rubber tread rhythm. Design translation: section dividers and focus rings.',
        },
      ],
      promptContext: {
        ...puppyPromptContext(),
        selectedCueImages: [
          {
            id: 'cue_playful_companion',
            label: 'Playful companion',
            routeFamily: 'playful-character',
            prompt: '1:1 full-bleed brand identity visual cue card. Product/site definition: Puppy Wear makes soft protective puppy shoes. Design translation: rounded icon language and gentle validation states.',
          },
          {
            id: 'cue_pattern_rhythm',
            label: 'Rhythm system',
            routeFamily: 'pattern-ornament',
            prompt: '1:1 full-bleed brand identity visual cue card. Primary visual subject: tiny paw geometry, soft rubber tread rhythm. Design translation: section dividers and focus rings.',
          },
        ],
      },
    });
    const routes = buildInitImageRoutes(request);
    const prompts = routes.map((route) => buildFluxPrompt(request, route));
    const combined = prompts.join('\n\n---\n\n');

    assert.equal(routes.length, 4);
    for (const route of routes) assert.equal(route.colors.length, 4);
    assert.match(combined, /Selected cue inheritance:/);
    assert.match(combined, /Playful companion/);
    assert.match(combined, /Rhythm system/);
    assert.match(combined, /playful-character/);
    assert.match(combined, /pattern-ornament/);
    assert.match(combined, /source prompt summary=.*Puppy Wear makes soft protective puppy shoes/);
    assert.match(combined, /More joyful and clean/);
    assert.match(combined, /Image 1: product-context \(puppy-walking\.png\)/);
    assert.match(combined, /color-world artifact/);
    assert.match(combined, /browser renders color names and OKLCH swatches separately/i);
    assert.doesNotMatch(combined, /Create ONE square 2x2|Required exact 2x2|quadrant sheet/i);
    assert.ok(prompts.every((prompt) => prompt.length <= 12000));
  });
});

describe('Flux provider', () => {
  it('starts four FLUX requests in parallel, sends x-key, polls, downloads, and returns four images', async () => {
    const createResolvers = [];
    const createBodies = [];
    const seenKeys = [];
    const png = pngBytes({ width: 16, height: 16, seed: 42 });

    const fetchImpl = async (url, options = {}) => {
      if (url === FLUX_ENDPOINT) {
        seenKeys.push(options.headers?.['x-key']);
        createBodies.push(JSON.parse(options.body));
        const index = createResolvers.length + 1;
        return new Promise((resolve) => {
          createResolvers.push(() => resolve(jsonResponse({
            id: `request-${index}`,
            polling_url: `https://poll.example/${index}`,
          })));
        });
      }
      if (String(url).startsWith('https://poll.example/')) {
        seenKeys.push(options.headers?.['x-key']);
        const index = String(url).split('/').pop();
        return jsonResponse({
          status: 'Ready',
          result: { sample: `https://images.example/${index}.png` },
        });
      }
      if (String(url).startsWith('https://images.example/')) {
        return bytesResponse(png);
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    const pending = generateFluxParallelResponse({
      request: sampleRequest({ batchId: 'cue_batch_flux' }),
      apiKey: 'bfl_test_secret',
      cwd: scratch,
      fetchImpl,
      pollIntervalMs: 1,
      timeoutMs: 1000,
      minDimension: 1,
    });

    await waitUntil(() => createResolvers.length === 4);
    assert.equal(createBodies.length, 4, 'all create calls should start before any is resolved');
    createResolvers.forEach((resolve) => resolve());

    const result = await pending;
    assert.equal(result.provider, 'flux');
    assert.equal(result.images.length, 4);
    assert.deepEqual([...new Set(seenKeys)], ['bfl_test_secret']);
    assert.equal(createBodies.every((body) => body.width === 1024 && body.height === 1024 && body.output_format === 'png'), true);
    assert.equal(createBodies.every((body) => body.prompt_upsampling === false), true);
    assert.equal(createBodies.every((body) => body.guidance === 7), true);
    assert.ok(new Set(createBodies.map((body) => body.prompt)).size === 4);
    assert.ok(result.images.every((image) => image.dataUrl.startsWith('data:image/png;base64,')));
  });

  it('retries a timed-out FLUX card without failing the whole batch', async () => {
    const png = pngBytes({ width: 16, height: 16, seed: 84 });
    let failedFirstRouteOnce = false;
    const createPrompts = [];

    const fetchImpl = async (url, options = {}) => {
      if (url === FLUX_ENDPOINT) {
        const body = JSON.parse(options.body);
        createPrompts.push(body.prompt);
        if (body.prompt.includes('Protective fold') && !failedFirstRouteOnce) {
          failedFirstRouteOnce = true;
          return jsonResponse({ polling_url: 'https://poll.example/timeout-once' });
        }
        return jsonResponse({
          polling_url: `https://poll.example/ready-${createPrompts.length}`,
        });
      }
      if (String(url) === 'https://poll.example/timeout-once') {
        return jsonResponse({ status: 'Pending' });
      }
      if (String(url).startsWith('https://poll.example/ready-')) {
        const index = String(url).split('-').pop();
        return jsonResponse({
          status: 'Ready',
          result: { sample: `https://images.example/${index}.png` },
        });
      }
      if (String(url).startsWith('https://images.example/')) {
        return bytesResponse(png);
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    const result = await generateFluxParallelResponse({
      request: sampleRequest({ batchId: 'cue_batch_retry' }),
      apiKey: 'bfl_test_secret',
      cwd: scratch,
      fetchImpl,
      pollIntervalMs: 1,
      timeoutMs: 5,
      retryBaseDelayMs: 1,
      maxAttempts: 2,
      minDimension: 1,
    });

    assert.equal(result.images.length, 4);
    assert.equal(failedFirstRouteOnce, true);
    assert.equal(createPrompts.filter((prompt) => prompt.includes('Protective fold')).length, 2);
    assert.equal(result.images.some((image) => image.generationAttempts === 2), true);
    assert.equal(result.images.every((image) => image.dataUrl.startsWith('data:image/png;base64,')), true);
  });
});

function sampleRequest(overrides = {}) {
  return {
    type: 'image_request',
    sessionId: 'q_test',
    slideId: 'visual-cues',
    kind: 'visual-cue',
    batchId: 'cue_batch_test',
    reason: 'initial-visual-cues',
    freeform: '',
    answers: {
      'product-overview': { value: 'Mira is a ceramic lamp studio for quiet homes.' },
      differentiator: { value: 'Hand-thrown and small batch.' },
      trust: { label: 'Material honesty', value: 'material honesty' },
      'audience-fit': { value: 'people who want quiet objects with presence' },
      'anti-audience': { value: 'not for glossy luxury drama' },
    },
    uploadedAssets: [
      { id: 'asset_1', index: 1, role: 'product-photo', name: 'lamp.png' },
    ],
    promptContext: {
      product: 'Mira is a ceramic lamp studio for quiet homes.',
      differentiator: 'Hand-thrown and small batch.',
      trust: 'Material honesty',
      audienceFit: 'people who want quiet objects with presence',
      antiAudience: 'not for glossy luxury drama',
      uploadedAssets: [
        { id: 'asset_1', index: 1, role: 'product-photo', name: 'lamp.png' },
      ],
    },
    ...overrides,
  };
}

function puppyRequest(overrides = {}) {
  return {
    type: 'image_request',
    sessionId: 'q_puppy',
    slideId: 'visual-cues',
    kind: 'visual-cue',
    batchId: 'cue_batch_puppy',
    reason: 'user-requested-more',
    freeform: '',
    answers: {
      'product-overview': { value: 'Puppy Wear makes soft protective puppy shoes for tiny paws on hot pavement, rain, and apartment floors.' },
      differentiator: { value: 'The shoes stay light, flexible, and washable while helping nervous puppies accept their first walks.' },
      trust: { value: 'Gentle paw protection that does not make the puppy fight the shoe.' },
      'audience-fit': { value: 'New puppy owners who are anxious about comfort, fit, and pavement safety.' },
      'anti-audience': { value: 'Not for costume fashion, stiff boots, or treating dogs like accessories.' },
    },
    uploadedAssets: puppyUploadedAssets(),
    promptContext: puppyPromptContext(),
    ...overrides,
  };
}

function puppyPromptContext() {
  return {
    product: 'Puppy Wear makes soft protective puppy shoes for tiny paws on hot pavement, rain, and apartment floors.',
    differentiator: 'The shoes stay light, flexible, and washable while helping nervous puppies accept their first walks.',
    trust: 'Gentle paw protection that does not make the puppy fight the shoe.',
    audienceFit: 'New puppy owners who are anxious about comfort, fit, and pavement safety.',
    antiAudience: 'Not for costume fashion, stiff boots, or treating dogs like accessories.',
    uploadedAssets: puppyUploadedAssets(),
  };
}

function puppyUploadedAssets() {
  return [
    { id: 'asset_1', index: 1, role: 'product-context', name: 'puppy-walking.png', width: 640, height: 640 },
    { id: 'asset_2', index: 2, role: 'material-reference', name: 'tiny-shoe-detail.png', width: 640, height: 640 },
    { id: 'asset_3', index: 3, role: 'review', name: 'puppy-parent-review.png', width: 640, height: 640 },
  ];
}

function jsonResponse(json) {
  return {
    ok: true,
    status: 200,
    json: async () => json,
    text: async () => JSON.stringify(json),
  };
}

function bytesResponse(bytes) {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

async function waitUntil(predicate, timeoutMs = 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for condition.');
}

function pngDataUrl(options) {
  return `data:image/png;base64,${pngBytes(options).toString('base64')}`;
}

function pngBytes({ width = 16, height = 16, seed = 0 } = {}) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(0);
    for (let x = 0; x < width; x += 1) {
      rows.push(
        (x * 13 + seed * 17) % 256,
        (y * 19 + seed * 23) % 256,
        ((x + y) * 11 + seed * 29) % 256,
        255,
      );
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.from(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
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
