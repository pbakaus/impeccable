#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveProjectRoot } from './context.mjs';
import {
  listSurfaceBriefs,
  resolveSurfaceBrief,
  surfaceBriefPathForTarget,
  writeSurfaceBrief,
} from './lib/surface-briefs.mjs';

function summary(brief, projectRoot) {
  return {
    slug: brief.slug,
    path: path.relative(projectRoot, brief.path).split(path.sep).join('/'),
    primaryTarget: brief.primaryTarget,
    relatedTargets: brief.relatedTargets,
  };
}

function main(argv) {
  const [command, target, bodyFile, ...relatedTargets] = argv;
  const projectRoot = resolveProjectRoot(process.cwd(), target ? { targetPath: target } : {});
  if (command === 'path') {
    const filePath = surfaceBriefPathForTarget(target, { projectRoot });
    if (!filePath) throw new Error('surface brief path requires a concrete target');
    process.stdout.write(`${path.relative(process.cwd(), filePath) || filePath}\n`);
    return;
  }
  if (command === 'list') {
    process.stdout.write(`${JSON.stringify(listSurfaceBriefs(projectRoot).map((brief) => summary(brief, projectRoot)), null, 2)}\n`);
    return;
  }
  if (command === 'read') {
    const result = resolveSurfaceBrief(projectRoot, target || null);
    if (result.brief) {
      process.stdout.write(result.brief.text);
      return;
    }
    if (result.candidates.length) process.stderr.write(`${JSON.stringify(result.candidates.map((brief) => summary(brief, projectRoot)), null, 2)}\n`);
    process.exit(2);
  }
  if (command === 'write') {
    if (!target || !bodyFile) throw new Error('usage: surface-brief.mjs write <primary-target> <body-file>');
    const filePath = writeSurfaceBrief({
      projectRoot,
      primaryTarget: target,
      relatedTargets,
      body: fs.readFileSync(bodyFile, 'utf-8'),
    });
    process.stdout.write(`${path.relative(process.cwd(), filePath) || filePath}\n`);
    return;
  }
  throw new Error('usage: surface-brief.mjs <path|list|read|write> [target] [body-file] [related-target ...]');
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]);
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  }
}

if (isMainModule()) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error?.message || error}\n`);
    process.exit(1);
  }
}
