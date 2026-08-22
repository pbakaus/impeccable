/**
 * Small read-only probes the framework entries share.
 *
 * Every helper here is cheap and failure-tolerant: detection runs on every
 * inject, against project trees that may be half-installed, so a missing or
 * malformed file means "not this framework", never a throw.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Merged dependency names from package.json, or an empty object. */
export function readPackageDeps(cwd) {
  const file = path.join(cwd, 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
      ...(pkg.peerDependencies || {}),
    };
  } catch {
    return {};
  }
}

export function hasAnyDependency(cwd, names) {
  const deps = readPackageDeps(cwd);
  return names.some((name) => Boolean(deps[name]));
}

/** First top-level file name matching `re`, or null. */
export function findConfigFile(cwd, re) {
  try {
    return fs.readdirSync(cwd, { withFileTypes: true })
      .find((entry) => entry.isFile() && re.test(entry.name))
      ?.name ?? null;
  } catch {
    return null;
  }
}

export function fileExists(cwd, rel) {
  try {
    return fs.existsSync(path.join(cwd, rel));
  } catch {
    return false;
  }
}

export function firstExistingFile(cwd, candidates) {
  for (const rel of candidates) {
    if (fileExists(cwd, rel)) return rel;
  }
  return null;
}

/**
 * Literal (non-glob) entries of `config.files` that exist on disk. Several
 * detectors read the configured injection target as a signal, which is how the
 * bare fixtures — a tree of `.astro` files with no astro.config — still resolve
 * to the framework that authored them.
 */
export function literalConfigFiles(cwd, config) {
  const files = Array.isArray(config?.files) ? config.files : [];
  const out = [];
  for (const rel of files) {
    if (typeof rel !== 'string' || rel.includes('*') || rel.includes('?')) continue;
    const normalized = rel.split(path.sep).join('/');
    if (fileExists(cwd, normalized)) out.push(normalized);
  }
  return out;
}
