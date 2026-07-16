#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { cp, copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'build-picker');
const outputDir = path.join(root, 'skill/scripts/picker');
const faviconSource = path.join(root, 'site/public/favicon.svg');
const faviconOutput = path.join(outputDir, 'favicon.svg');
const heroSource = path.join(
  root,
  'site/public/assets/neo-kinpaku/candidates/finalists/m-01-v2-01-light.png',
);
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
await sharp(heroSource)
  .resize({ width: 1536, withoutEnlargement: true })
  .jpeg({ quality: 80, mozjpeg: true })
  .toFile(heroOutput);
await rm(buildDir, { recursive: true, force: true });

console.log(`Built ${path.relative(root, outputDir)}/`);
