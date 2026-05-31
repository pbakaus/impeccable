/**
 * Tests for live-svelte-component.mjs
 * Run with: node --test tests/live-svelte-component.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildPropContract,
  extractMustacheExpressions,
  inlineSvelteComponentAccept,
  scaffoldSvelteComponentSession,
  substitutePropsWithExprs,
} from '../skill/scripts/live-svelte-component.mjs';

describe('live-svelte-component helpers', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'impeccable-svelte-component-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('extracts ordered mustache expressions and builds a prop contract', () => {
    const markup = `<article><strong>{expenses[0].name}</strong><span>{expenses[0].amount}</span></article>`;
    const expressions = extractMustacheExpressions(markup);
    assert.deepEqual(expressions, ['expenses[0].name', 'expenses[0].amount']);
    const contract = buildPropContract(expressions);
    assert.equal(contract[0].prop, 'name');
    assert.equal(contract[1].prop, 'amount');
  });

  it('scaffolds component session files without touching the route source', () => {
    mkdirSync(join(tmp, 'src/routes'), { recursive: true });
    writeFileSync(join(tmp, 'src/routes/+page.svelte'), `<main>
  <article class="expense-row">
    <strong>{expenses[0].name}</strong>
    <span>{expenses[0].amount}</span>
  </article>
</main>
`);
    const session = scaffoldSvelteComponentSession({
      id: 'abc123',
      count: 2,
      sourceFile: 'src/routes/+page.svelte',
      sourceStartLine: 2,
      sourceEndLine: 5,
      originalLines: [
        '  <article class="expense-row">',
        '    <strong>{expenses[0].name}</strong>',
        '    <span>{expenses[0].amount}</span>',
        '  </article>',
      ],
      cwd: tmp,
    });
    assert.equal(session.manifest.previewMode, 'svelte-component');
    assert.match(session.componentDir, /^node_modules\/\.impeccable-live\/abc123$/);
    assert.ok(readFileSync(join(tmp, session.manifestFile), 'utf-8').includes('"id": "abc123"'));
    assert.ok(readFileSync(join(tmp, session.componentDir, 'v1.svelte'), 'utf-8').includes('{name}'));
    assert.ok(readFileSync(join(tmp, 'src/routes/+page.svelte'), 'utf-8').includes('{expenses[0].name}'));
  });

  it('inlines accepted component markup and CSS with original bindings restored', () => {
    mkdirSync(join(tmp, 'src/routes'), { recursive: true });
    mkdirSync(join(tmp, 'src/lib/impeccable/INLINE'), { recursive: true });
    writeFileSync(join(tmp, 'src/routes/+page.svelte'), `<main>
  <article class="expense-row" data-testid="expense-row">
    <strong>{expenses[0].name}</strong>
    <span>{expenses[0].amount}</span>
  </article>
</main>
`);
    const manifest = {
      id: 'INLINE',
      sourceFile: 'src/routes/+page.svelte',
      sourceStartLine: 2,
      sourceEndLine: 5,
      componentDir: 'src/lib/impeccable/INLINE',
      originalMarkup: `<article class="expense-row" data-testid="expense-row">
  <strong>{expenses[0].name}</strong>
  <span>{expenses[0].amount}</span>
</article>`,
      propContract: [
        { prop: 'name', expr: 'expenses[0].name', placeholder: '{expenses[0].name}' },
        { prop: 'amount', expr: 'expenses[0].amount', placeholder: '{expenses[0].amount}' },
      ],
    };
    writeFileSync(join(tmp, manifest.componentDir, 'v1.svelte'), `<script>
  let { name, amount } = $props();
</script>
<article class="expense-row accepted">
  <strong>{name}</strong>
  <span>{amount}</span>
</article>
<style>
  .accepted { padding: 24px; }
</style>
`);
    const result = inlineSvelteComponentAccept(manifest, 1, null, tmp);
    assert.equal(result.handled, true);
    const after = readFileSync(join(tmp, 'src/routes/+page.svelte'), 'utf-8');
    assert.ok(after.includes('{expenses[0].name}'));
    assert.ok(after.includes('.accepted { padding: 24px; }'));
    assert.ok(after.includes('class="expense-row accepted"'));
    assert.ok(after.includes('data-testid="expense-row"'));
    assert.ok(!after.includes('{name}'));
  });
});
