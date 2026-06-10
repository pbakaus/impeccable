import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ANTIPATTERNS, getDefaultRules } from '../cli/engine/registry/antipatterns.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('extension DevTools packaging', () => {
  it('uses extension-root paths for DevTools panel pages', () => {
    const source = readFileSync(path.join(ROOT, 'extension/devtools/devtools.js'), 'utf-8');

    assert.match(
      source,
      /chrome\.devtools\.panels\.create\(\s*['"]Impeccable['"],\s*['"]\/icons\/icon-32\.png['"],\s*['"]\/devtools\/panel\.html['"]\s*\)/s,
      'Firefox resolves DevTools URLs relative to devtools.html unless they start at the extension root',
    );
    assert.match(source, /sidebar\.setPage\(['"]\/devtools\/sidebar\.html['"]\)/);
    assert.doesNotMatch(source, /['"]devtools\/(?:panel|sidebar)\.html['"]/);
    assert.doesNotMatch(source, /['"]icons\/icon-32\.png['"]/);
  });

  it('omits conditional detector rules from generated settings metadata', () => {
    const generated = JSON.parse(readFileSync(path.join(ROOT, 'extension/detector/antipatterns.json'), 'utf-8'));
    const generatedIds = generated.map(rule => rule.id);
    const defaultIds = getDefaultRules().map(rule => rule.id);
    const conditionalIds = ANTIPATTERNS.filter(rule => rule.conditional).map(rule => rule.id);

    assert.deepEqual(generatedIds, defaultIds);
    for (const id of conditionalIds) {
      assert.equal(generatedIds.includes(id), false, `${id} should not render as a dead extension toggle`);
    }
  });
});
