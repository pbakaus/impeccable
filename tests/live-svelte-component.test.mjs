import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { inlineSvelteComponentAccept } from '../skill/scripts/live-svelte-component.mjs';

describe('Svelte component live accept', () => {
  let tmp;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'impeccable-svelte-component-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('keeps toggle CSS branches that use boolean-looking selector values', () => {
    mkdirSync(join(tmp, 'node_modules/.impeccable-live/toggle-test'), { recursive: true });
    writeFileSync(
      join(tmp, 'src.svelte'),
      [
        '<script>',
        '  let expenses = [{ id: 1 }];',
        '</script>',
        '',
        '<span class="open-count">{expenses.length} offen</span>',
        '',
        '<style>',
        '.open-count { font-weight: 700; }',
        '</style>',
        '',
      ].join('\n'),
      'utf-8',
    );
    writeFileSync(
      join(tmp, 'node_modules/.impeccable-live/toggle-test/v1.svelte'),
      [
        '<script>',
        '  let { length } = $props();',
        '</script>',
        '',
        '<span class="open-count"><span class="bolder-text">{length} offen</span></span>',
        '',
        '<style>',
        ':global(.open-count[data-p-uppercase="true"] .bolder-text) { text-transform: uppercase; letter-spacing: 0.05em; }',
        ':global(.open-count[data-p-uppercase="false"] .bolder-text) { opacity: 0.4; }',
        ':global(.open-count[data-p-shadow="on"] .bolder-text) { text-shadow: 0 1px 0 black; }',
        '</style>',
        '',
      ].join('\n'),
      'utf-8',
    );

    const manifest = {
      id: 'toggle-test',
      sourceFile: 'src.svelte',
      componentDir: 'node_modules/.impeccable-live/toggle-test',
      sourceStartLine: 5,
      sourceEndLine: 5,
      originalMarkup: '<span class="open-count">{expenses.length} offen</span>',
      propContract: [{ prop: 'length', expr: 'expenses.length' }],
    };

    const result = inlineSvelteComponentAccept(manifest, 1, { uppercase: true, shadow: true }, tmp);
    assert.equal(result.handled, true);

    const after = readFileSync(join(tmp, 'src.svelte'), 'utf-8');
    assert.match(after, /\{expenses\.length\} offen/);
    assert.match(after, /text-transform:\s*uppercase/);
    assert.match(after, /letter-spacing:\s*0\.05em/);
    assert.match(after, /text-shadow:\s*0 1px 0 black/);
    assert.doesNotMatch(after, /opacity:\s*0\.4/);
    assert.doesNotMatch(after, /data-p-uppercase/);
  });
});
