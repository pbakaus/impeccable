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
const faviconSource = path.join(root, 'picker/assets/favicon.svg');
const faviconOutput = path.join(outputDir, 'favicon.svg');
const heroSource = path.join(root, 'picker/assets/hero-light.jpg');
const heroOutput = path.join(outputDir, 'assets/hero-light.jpg');

await rm(buildDir, { recursive: true, force: true });
execFileSync(
  'bun',
  ['x', 'astro', 'build', '--config', 'picker/astro.config.mjs'],
  { cwd: root, stdio: 'inherit' },
);

await rm(outputDir, { recursive: true, force: true });
await cp(buildDir, outputDir, { recursive: true });
await mkdir(path.dirname(heroOutput), { recursive: true });
await copyFile(faviconSource, faviconOutput);
await copyFile(heroSource, heroOutput);
await rm(buildDir, { recursive: true, force: true });

console.log(`Built ${path.relative(root, outputDir)}/`);
