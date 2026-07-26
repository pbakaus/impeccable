#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { cp, copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
// The page links ./favicon.svg, so it is also served from the output root.
const faviconSource = path.join(assetsSource, 'favicon.svg');
const faviconOutput = path.join(outputDir, 'favicon.svg');
// The icon specimen is fetched at runtime rather than inlined, so it ships
// beside the page instead of going through Vite. Regenerate it with
// `node scripts/vendor-icons.mjs`.
const iconDataSource = path.join(root, 'picker/data/icon-packs.json');
const iconDataOutput = path.join(outputDir, 'icon-packs.json');

await rm(buildDir, { recursive: true, force: true });
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
await rm(buildDir, { recursive: true, force: true });

console.log(`Built ${path.relative(root, outputDir)}/`);
