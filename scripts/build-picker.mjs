#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { cp, copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANTIPATTERNS } from '../cli/engine/registry/antipatterns.mjs';
import { composeHookRules } from './lib/hook-rule-presentation.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'build-picker');
const outputDir = path.join(root, 'skill/scripts/picker');
// Static assets vendored under picker/assets/ (the site now lives in the
// private impeccable-site repo, so the picker carries its own copies).
// Static assets vendored under picker/assets/ (the site now lives in the
// private impeccable-site repo, so the picker carries its own copies). These
// are referenced from markup at runtime, so Vite never sees them.
const assetsSource = path.join(root, 'picker/assets');
const assetsOutput = path.join(outputDir, 'assets');
const runtimeAssets = ['hero-dark.jpg', 'kinpaku-gold-leaf.jpg'];
// The design context document's images, vendored from the standalone demo:
// per-section foil icons, the rail textures, the brand-asset placeholders, and
// the components photo. Whole directories, so a demo re-sync stays a plain copy.
const runtimeAssetDirs = ['audience', 'product', 'brand', 'color', 'typography', 'material', 'components'];
// The page links ./favicon.svg, so it is also served from the output root.
const faviconSource = path.join(assetsSource, 'favicon.svg');
const faviconOutput = path.join(outputDir, 'favicon.svg');
// The icon specimen is fetched at runtime rather than inlined, so it ships
// beside the page instead of going through Vite. Regenerate it with
// `node scripts/vendor-icons.mjs`.
const iconDataSource = path.join(root, 'picker/data/icon-packs.json');
const iconDataOutput = path.join(outputDir, 'icon-packs.json');

await rm(buildDir, { recursive: true, force: true });
// The Hooks page's rule list, composed from the canonical detector registry so
// the document never drifts from what the hook actually enforces. Committed and
// regenerated every build; tests/hook-rule-presentation.test.js guards the sync.
await writeFile(
  path.join(root, 'picker/data/hook-rules.json'),
  `${JSON.stringify(composeHookRules(ANTIPATTERNS), null, 2)}\n`,
);
execFileSync(
  'bun',
  ['x', 'astro', 'build', '--config', 'picker/astro.config.mjs'],
  { cwd: root, stdio: 'inherit' },
);

await rm(outputDir, { recursive: true, force: true });
await cp(buildDir, outputDir, { recursive: true });
await mkdir(assetsOutput, { recursive: true });
await copyFile(faviconSource, faviconOutput);
await copyFile(iconDataSource, iconDataOutput);
for (const asset of runtimeAssets) {
  await copyFile(path.join(assetsSource, asset), path.join(assetsOutput, asset));
}
for (const dir of runtimeAssetDirs) {
  await cp(path.join(assetsSource, dir), path.join(assetsOutput, dir), { recursive: true });
}
await rm(buildDir, { recursive: true, force: true });

console.log(`Built ${path.relative(root, outputDir)}/`);
