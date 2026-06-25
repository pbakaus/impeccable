#!/usr/bin/env node
/**
 * Scan locale / i18n string files for COPY.md evidence.
 * Output is i18n metadata + samples — NOT voice. Pair with document-copy interview.
 * Usage: node scan-copy.mjs [--target <path>] [--limit N]
 */
import fs from 'node:fs';
import path from 'node:path';

const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

const LOCALE_FILE_RE =
  /^(text\.[a-z]{2}(-[A-Z]{2})?\.json|messages\.(en|en-US)\.json|en\.json|en-US\.json)$/i;

function parseArgs(argv) {
  let target = process.cwd();
  let sampleLimit = 3;
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--target' || argv[i] === '-t') && argv[i + 1]) {
      target = path.resolve(argv[++i]);
    } else if (argv[i] === '--limit' && argv[i + 1]) {
      sampleLimit = Number(argv[++i]) || 3;
    }
  }
  return { target, sampleLimit };
}

function isLocaleFile(name, parentDir) {
  if (LOCALE_FILE_RE.test(name)) return true;
  if (parentDir === 'text' && /^[a-z]{2}(-[A-Z]{2})?\.json$/.test(name)) return true;
  if (parentDir === 'locales' && name.endsWith('.json')) return true;
  return false;
}

function walk(dir, files = [], parentName = '') {
  if (!fs.existsSync(dir)) return files;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, files, ent.name);
    else if (isLocaleFile(ent.name, parentName)) files.push(p);
  }
  return files;
}

function keyTokens(key) {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isAiKey(key) {
  const tokens = keyTokens(key);
  return tokens.includes('ai') || tokens.includes('suggest') || tokens.includes('generated');
}

function categorizeKey(key) {
  const k = key.toLowerCase();
  if (k.includes('error') || k.endsWith('.error')) return 'errors';
  if (k.includes('modal') || k.includes('confirm')) return 'confirmations';
  if (k.includes('empty') || k.includes('noresult')) return 'empty';
  if (k.includes('loading') || k.includes('spinner')) return 'loading';
  if (k.includes('success') || k.includes('saved')) return 'success';
  if (k.includes('label') || k.includes('description') || k.includes('placeholder')) return 'forms';
  if (k.includes('submit') || k.includes('cancel') || k === 'ok' || k.includes('button')) return 'buttons';
  if (k.includes('title') || k.includes('heading')) return 'headings';
  if (k.includes('aria')) return 'aria';
  if (isAiKey(key)) return 'ai';
  return 'other';
}

function collectStringEntries(obj, prefix = '') {
  const entries = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      entries.push([fullKey, value]);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      entries.push(...collectStringEntries(value, fullKey));
    }
  }
  return entries;
}

function topValues(map, n = 15) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([value, count]) => ({ value, count }));
}

function main() {
  const { target, sampleLimit } = parseArgs(process.argv.slice(2));
  const files = walk(target);
  const valueCounts = new Map();
  const keySuffixes = new Map();
  const categories = {};
  const samples = {};
  let keyCount = 0;
  let icuCount = 0;
  let variantKeyCount = 0;

  for (const file of files) {
    const rel = path.relative(target, file);
    let json;
    try {
      json = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }

    for (const [key, value] of collectStringEntries(json)) {
      keyCount++;
      valueCounts.set(value, (valueCounts.get(value) || 0) + 1);

      if (key.includes('@')) {
        variantKeyCount++;
        const suffix = key.split('@').slice(1).join('@');
        keySuffixes.set(suffix, (keySuffixes.get(suffix) || 0) + 1);
      }
      if (value.includes('{') && value.includes('plural')) icuCount++;

      const cat = categorizeKey(key);
      categories[cat] = (categories[cat] || 0) + 1;
      if (!samples[cat]) samples[cat] = [];
      if (samples[cat].length < sampleLimit) {
        samples[cat].push({ key, value: value.slice(0, 120), file: rel });
      }
    }
  }

  const result = {
    target,
    scannedAt: new Date().toISOString(),
    disclaimer:
      'Evidence for i18n mechanics and debt signals only. Do NOT treat frequentStrings as voice. Run document-copy interview for experience promise and journeys.',
    stats: {
      localeFiles: files.length,
      totalKeys: keyCount,
      variantKeys: variantKeyCount,
      icuStrings: icuCount,
      byCategory: categories,
    },
    detectedFilePatterns: [...new Set(files.map((f) => path.basename(f)))].slice(0, 20),
    topVariantSuffixes: topValues(keySuffixes, 12),
    frequentStrings: topValues(valueCounts, 15),
    debtSignals: {
      genericErrorTitles: valueCounts.get('Error') || valueCounts.get('Something went wrong') || 0,
      bareSuccess: valueCounts.get('Success') || 0,
      bareCancel: valueCounts.get('Cancel') || 0,
      bareLoading: valueCounts.get('Loading...') || valueCounts.get('Loading') || 0,
    },
    samples,
    nextSteps: [
      'Map 5-8 journeys from PRODUCT.md — walk locale files in flow order',
      'Run experience interview (document-copy.md Step 4)',
      'Build journey playbooks — not frequency tables',
    ],
  };

  console.log(JSON.stringify(result, null, 2));
}

main();
