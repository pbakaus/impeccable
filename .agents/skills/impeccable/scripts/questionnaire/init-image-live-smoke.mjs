#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildBuiltInQuadrantRequest,
  cropBuiltInQuadrantSheet,
  generateFluxParallelResponse,
  resolveImageProviderConfig,
} from './init-image-provider.mjs';

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const cwd = path.resolve(args.cwd || process.cwd());
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.resolve(args.out || path.join(cwd, '.impeccable', 'init', 'live-image-smoke', stamp));
const request = sampleVisualCueRequest(args);

fs.mkdirSync(runDir, { recursive: true });

const provider = resolveImageProviderConfig({ cwd, env: process.env });
if (provider.provider === 'flux') {
  const result = await generateFluxParallelResponse({
    request,
    apiKey: provider.apiKey,
    cwd,
    artifactDir: path.join(runDir, 'cards'),
    pollIntervalMs: Number(args.pollIntervalMs || 750),
    timeoutMs: Number(args.timeoutMs || 300000),
    minDimension: Number(args.minDimension || 512),
  });
  const previewPath = previewImages(result.images.map((image) => image.localPath), path.join(runDir, 'flux-cards-preview.png'));
  writeManifest(runDir, {
    provider: 'flux',
    model: result.model,
    previewPath,
    images: publicImages(result.images),
    metrics: result.metrics,
  });
  console.log(JSON.stringify({ ok: true, provider: 'flux', runDir, previewPath }, null, 2));
  process.exit(0);
}

const quadrant = buildBuiltInQuadrantRequest(request);
fs.writeFileSync(path.join(runDir, 'builtin-quadrant-prompt.txt'), `${quadrant.prompt}\n`);

if (!args.sheet) {
  writeManifest(runDir, {
    provider: 'builtin-quadrant',
    status: 'needs-sheet',
    promptPath: path.join(runDir, 'builtin-quadrant-prompt.txt'),
    message: 'Generate one built-in 2x2 sheet from promptPath, then rerun with --sheet <png>.',
  });
  console.log(JSON.stringify({
    ok: true,
    provider: 'builtin-quadrant',
    status: 'needs-sheet',
    runDir,
    promptPath: path.join(runDir, 'builtin-quadrant-prompt.txt'),
  }, null, 2));
  process.exit(0);
}

const result = await cropBuiltInQuadrantSheet({
  request,
  sheetPath: args.sheet,
  cwd,
  artifactDir: path.join(runDir, 'cards'),
  minDimension: Number(args.minDimension || 512),
});
const previewPath = previewImages(result.images.map((image) => image.localPath), path.join(runDir, 'builtin-crops-preview.png'));
writeManifest(runDir, {
  provider: 'builtin-quadrant',
  sourceSheet: path.resolve(cwd, args.sheet),
  previewPath,
  images: publicImages(result.images),
});
console.log(JSON.stringify({ ok: true, provider: 'builtin-quadrant', runDir, previewPath }, null, 2));

function sampleVisualCueRequest(options = {}) {
  return {
    type: 'image_request',
    sessionId: 'q_live_smoke',
    slideId: 'visual-cues',
    kind: 'visual-cue',
    batchId: `cue_batch_live_${Date.now().toString(36)}`,
    reason: 'live-image-smoke',
    freeform: options.direction || 'More abstract and art-directed, not four ceramic still lifes. Include one graphic route and one surreal route.',
    answers: {
      'product-overview': { value: options.product || 'Mira is a ceramic lamp studio for people who want quiet, sculptural lighting at home.' },
      differentiator: { value: options.differentiator || 'Each lamp is hand-thrown, fired in small batches, and designed to look calm even when switched off.' },
      trust: { label: options.trust || 'Material honesty', value: options.trust || 'Material honesty' },
      'audience-fit': { value: options.audience || 'people who want quiet objects with presence, not visual noise' },
      'anti-audience': { value: options.avoid || 'not for glossy luxury drama, bargain decor, or trend-led maximalism' },
    },
    uploadedAssets: [],
    promptContext: {
      product: options.product || 'Mira is a ceramic lamp studio for people who want quiet, sculptural lighting at home.',
      differentiator: options.differentiator || 'Each lamp is hand-thrown, fired in small batches, and designed to look calm even when switched off.',
      trust: options.trust || 'Material honesty',
      audienceFit: options.audience || 'people who want quiet objects with presence, not visual noise',
      antiAudience: options.avoid || 'not for glossy luxury drama, bargain decor, or trend-led maximalism',
      userDirection: options.direction || 'More abstract and art-directed, not four ceramic still lifes. Include one graphic route and one surreal route.',
      uploadedAssets: [],
    },
  };
}

function previewImages(imagePaths, outPath) {
  execFileSync(findMagick(), [
    'montage',
    ...imagePaths,
    '-tile', '4x1',
    '-geometry', '320x320+18+18',
    '-background', '#060604',
    outPath,
  ]);
  return outPath;
}

function publicImages(images) {
  return images.map(({ id, label, routeFamily, prompt, localPath, width, height, sha256 }) => ({
    id,
    label,
    routeFamily,
    localPath,
    width,
    height,
    sha256,
    promptPreview: String(prompt || '').slice(0, 360),
  }));
}

function writeManifest(runDir, value) {
  fs.writeFileSync(path.join(runDir, 'manifest.json'), `${JSON.stringify(value, null, 2)}\n`);
}

function findMagick() {
  for (const candidate of ['/opt/homebrew/bin/magick', '/usr/local/bin/magick', '/usr/bin/magick']) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('ImageMagick magick binary is required for preview assembly.');
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--help' || item === '-h') {
      out.help = true;
      continue;
    }
    if (!item.startsWith('--')) throw new Error(`Unexpected argument: ${item}`);
    const key = item.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    out[key] = value;
    index += 1;
  }
  return out;
}

function printHelp() {
  console.log(`Usage:
  node skill/scripts/questionnaire/init-image-live-smoke.mjs

With IMAGE_API_KEY in .impeccable/.env, runs four live Flux requests in parallel.
Without a key, writes builtin-quadrant-prompt.txt. After generating one built-in
2x2 sheet, crop it with:

  node skill/scripts/questionnaire/init-image-live-smoke.mjs --sheet /path/to/sheet.png
`);
}
