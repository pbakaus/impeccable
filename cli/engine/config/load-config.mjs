import fs from 'node:fs';
import path from 'node:path';

// Project configuration discovery. JSON only (no executable config) to preserve
// the detector's no-code-execution posture. Lookup order, first hit wins:
//   1. impeccable.config.json
//   2. .impeccablerc.json
//   3. package.json "impeccable" key
// searched from the start directory upward to the filesystem root.

const CONFIG_FILENAMES = ['impeccable.config.json', '.impeccablerc.json'];

const DEFAULT_CONFIG = Object.freeze({
  disabledRules: [],
  ignore: [],
  severity: {},
  lineLengthMax: undefined,
});

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    process.stderr.write(`Warning: ignoring invalid config at ${file}: ${e.message}\n`);
    return null;
  }
}

// Search startDir upward; return the first raw config object found, or null.
function findConfig(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) {
        const parsed = readJson(candidate);
        if (parsed) return parsed;
      }
    }
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = readJson(pkgPath);
      if (pkg && pkg.impeccable && typeof pkg.impeccable === 'object') return pkg.impeccable;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function normalize(raw) {
  const cfg = { ...DEFAULT_CONFIG };
  if (Array.isArray(raw.disabledRules)) cfg.disabledRules = raw.disabledRules.filter(x => typeof x === 'string');
  if (Array.isArray(raw.ignore)) cfg.ignore = raw.ignore.filter(x => typeof x === 'string');
  if (raw.severity && typeof raw.severity === 'object') cfg.severity = { ...raw.severity };
  if (Number.isFinite(raw.lineLengthMax)) cfg.lineLengthMax = raw.lineLengthMax;
  return cfg;
}

function loadConfig(startDir = process.cwd()) {
  const raw = findConfig(startDir);
  return raw ? normalize(raw) : { ...DEFAULT_CONFIG };
}

export { loadConfig, findConfig, DEFAULT_CONFIG, CONFIG_FILENAMES };
