import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'skill',
  'scripts',
  'scan-copy.mjs',
);

let scratch;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'impeccable-scan-copy-'));
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('scan-copy.mjs', () => {
  it('scans locale json files and reports evidence metadata', () => {
    const localeDir = path.join(scratch, 'locales');
    fs.mkdirSync(localeDir, { recursive: true });
    fs.writeFileSync(
      path.join(localeDir, 'en.json'),
      JSON.stringify({
        'app.title': 'Taskflow',
        'form.email.error': 'Enter a valid email address',
        'empty.projects': 'No projects yet',
        'button.save': 'Save',
      }),
    );

    const res = spawnSync(process.execPath, [SCRIPT_PATH, '--target', scratch], { encoding: 'utf8' });
    assert.equal(res.status, 0);
    const data = JSON.parse(res.stdout);
    assert.equal(data.stats.localeFiles, 1);
    assert.equal(data.stats.totalKeys, 4);
    assert.match(data.disclaimer, /Do NOT treat frequentStrings as voice/);
    assert.ok(data.samples.errors || data.samples.forms || data.samples.empty);
  });

  it('returns empty stats when no locale files exist', () => {
    const res = spawnSync(process.execPath, [SCRIPT_PATH, '--target', scratch], { encoding: 'utf8' });
    assert.equal(res.status, 0);
    const data = JSON.parse(res.stdout);
    assert.equal(data.stats.localeFiles, 0);
    assert.equal(data.stats.totalKeys, 0);
  });

  it('scans nested locale json (i18next-style catalogs)', () => {
    const localeDir = path.join(scratch, 'locales');
    fs.mkdirSync(localeDir, { recursive: true });
    fs.writeFileSync(
      path.join(localeDir, 'en.json'),
      JSON.stringify({
        common: {
          save: 'Save',
          cancel: 'Cancel',
        },
        errors: {
          network: 'Network error',
        },
      }),
    );

    const res = spawnSync(process.execPath, [SCRIPT_PATH, '--target', scratch], { encoding: 'utf8' });
    assert.equal(res.status, 0);
    const data = JSON.parse(res.stdout);
    assert.equal(data.stats.localeFiles, 1);
    assert.equal(data.stats.totalKeys, 3);
  });

  it('does not count hashtag template strings as ICU plurals', () => {
    const localeDir = path.join(scratch, 'locales');
    fs.mkdirSync(localeDir, { recursive: true });
    fs.writeFileSync(
      path.join(localeDir, 'en.json'),
      JSON.stringify({
        'user.created': 'User #{username} created',
        'achievement.rank': 'Top #{rank} achievement',
        'items.count': '{count, plural, one {# item} other {# items}}',
      }),
    );

    const res = spawnSync(process.execPath, [SCRIPT_PATH, '--target', scratch], { encoding: 'utf8' });
    assert.equal(res.status, 0);
    const data = JSON.parse(res.stdout);
    assert.equal(data.stats.icuStrings, 1);
  });

  it('does not classify email/detail/paid keys as ai', () => {
    const localeDir = path.join(scratch, 'locales');
    fs.mkdirSync(localeDir, { recursive: true });
    fs.writeFileSync(
      path.join(localeDir, 'en.json'),
      JSON.stringify({
        'user.email': 'Email',
        'order.detail': 'Details',
        'invoice.paid': 'Paid',
        'feature.ai.summary': 'AI summary',
      }),
    );

    const res = spawnSync(process.execPath, [SCRIPT_PATH, '--target', scratch], { encoding: 'utf8' });
    assert.equal(res.status, 0);
    const data = JSON.parse(res.stdout);
    assert.equal(data.stats.byCategory.ai, 1);
    const aiKeys = (data.samples.ai || []).map((s) => s.key);
    assert.ok(aiKeys.includes('feature.ai.summary'));
    assert.ok(!aiKeys.includes('user.email'));
    assert.ok(!aiKeys.includes('order.detail'));
    assert.ok(!aiKeys.includes('invoice.paid'));
  });

  it('does not classify suggestion keys as ai', () => {
    const localeDir = path.join(scratch, 'locales');
    fs.mkdirSync(localeDir, { recursive: true });
    fs.writeFileSync(
      path.join(localeDir, 'en.json'),
      JSON.stringify({
        'form.suggestion.label': 'Suggestion',
        'search.suggestions.title': 'Suggestions',
        'copilot.suggest.action': 'Suggest with AI',
      }),
    );

    const res = spawnSync(process.execPath, [SCRIPT_PATH, '--target', scratch], { encoding: 'utf8' });
    assert.equal(res.status, 0);
    const data = JSON.parse(res.stdout);
    assert.equal(data.stats.byCategory.ai, 1);
    const aiKeys = (data.samples.ai || []).map((s) => s.key);
    assert.ok(aiKeys.includes('copilot.suggest.action'));
    assert.ok(!aiKeys.includes('form.suggestion.label'));
    assert.ok(!aiKeys.includes('search.suggestions.title'));
  });

  it('ignores typescript locale modules (json-only scanner)', () => {
    const localeDir = path.join(scratch, 'locales');
    fs.mkdirSync(localeDir, { recursive: true });
    fs.writeFileSync(path.join(localeDir, 'messages.en.ts'), "export default { title: 'App' };");
    fs.writeFileSync(
      path.join(localeDir, 'en.json'),
      JSON.stringify({ 'app.title': 'Taskflow' }),
    );

    const res = spawnSync(process.execPath, [SCRIPT_PATH, '--target', scratch], { encoding: 'utf8' });
    assert.equal(res.status, 0);
    const data = JSON.parse(res.stdout);
    assert.equal(data.stats.localeFiles, 1);
    assert.equal(data.stats.totalKeys, 1);
  });
});
