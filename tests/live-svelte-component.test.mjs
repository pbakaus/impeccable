import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildPropContract,
  cleanupSvelteComponentTailwindSafelists,
  extractMustacheExpressions,
  inlineSvelteComponentAccept,
  syncSvelteComponentTailwindSafelist,
  substituteExprsWithProps,
} from '../skill/scripts/live-svelte-component.mjs';

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

  it('does not turn Svelte block markers into component props', () => {
    const markup = [
      '<article class="movie-card">',
      '  <div class="movie-card__poster">',
      '    {#if movie.posterUrl}',
      '      <img src={movie.posterUrl} alt="" />',
      '    {:else}',
      '      <span>No poster</span>',
      '    {/if}',
      '  </div>',
      '  <h3>{movie.title}</h3>',
      '  <p><span>{movie.year}</span><span>·</span><span>{movie.rating}</span></p>',
      '</article>',
    ].join('\n');

    const expressions = extractMustacheExpressions(markup);
    assert.deepEqual(expressions, [
      'movie.posterUrl',
      'movie.title',
      'movie.year',
      'movie.rating',
    ]);

    const contract = buildPropContract(expressions);
    assert.deepEqual(contract.map((entry) => entry.prop), ['posterUrl', 'title', 'year', 'rating']);
    const withProps = substituteExprsWithProps(markup, contract);
    assert.match(withProps, /\{#if posterUrl\}/);
    assert.match(withProps, /src=\{posterUrl\}/);
    assert.match(withProps, /\{title\}/);
    assert.doesNotMatch(withProps, /#if movie\.posterUrl/);
    assert.doesNotMatch(withProps, /let \{ posterUrl, posterUrl/);
  });

  it('deduplicates prop names that share the same expression tail', () => {
    const contract = buildPropContract(['user.name', 'team.name', 'user.id']);
    assert.deepEqual(contract.map((entry) => entry.prop), ['name', 'name2', 'id']);
  });

  it('safelists generated Tailwind utilities for Svelte component previews', () => {
    mkdirSync(join(tmp, 'src'), { recursive: true });
    mkdirSync(join(tmp, 'node_modules/.impeccable-live/tailwind-test'), { recursive: true });
    writeFileSync(join(tmp, 'src/app.css'), '@import "tailwindcss";\n', 'utf-8');
    writeFileSync(
      join(tmp, 'node_modules/.impeccable-live/tailwind-test/manifest.json'),
      JSON.stringify({
        id: 'tailwind-test',
        previewMode: 'svelte-component',
        sourceFile: 'src/routes/+page.svelte',
        componentDir: 'node_modules/.impeccable-live/tailwind-test',
        count: 2,
      }, null, 2) + '\n',
      'utf-8',
    );
    writeFileSync(
      join(tmp, 'node_modules/.impeccable-live/tailwind-test/v1.svelte'),
      '<article><div class="tailwind-v1 bg-amber-100 text-amber-950 border-amber-400 rounded-2xl p-6 shadow-lg min-h-24">Tailwind balance $24</div></article>\n',
      'utf-8',
    );
    writeFileSync(
      join(tmp, 'node_modules/.impeccable-live/tailwind-test/v2.svelte'),
      '<article><div class="tailwind-v2 bg-sky-100 text-sky-950 border-sky-400 rounded-2xl p-6 shadow-xl min-h-28">Tailwind balance $24</div></article>\n',
      'utf-8',
    );

    const result = syncSvelteComponentTailwindSafelist('node_modules/.impeccable-live/tailwind-test/manifest.json', tmp);
    assert.equal(result.ok, true);
    assert.deepEqual(result.written, ['src/app.css']);

    const css = readFileSync(join(tmp, 'src/app.css'), 'utf-8');
    assert.match(css, /impeccable-live-tailwind-safelist:start/);
    assert.match(css, /@source inline\("p-6"\);/);
    assert.match(css, /@source inline\("shadow-xl"\);/);
    assert.match(css, /@source inline\("min-h-28"\);/);
    assert.doesNotMatch(css, /svelte-/);

    const cleanup = cleanupSvelteComponentTailwindSafelists(tmp);
    assert.deepEqual(cleanup.cleaned, ['src/app.css']);
    const cleaned = readFileSync(join(tmp, 'src/app.css'), 'utf-8');
    assert.equal(cleaned, '@import "tailwindcss";\n');
  });
});
