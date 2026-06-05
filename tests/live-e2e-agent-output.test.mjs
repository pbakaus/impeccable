import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  repairSvelteVariantRootClasses,
  validateRequestedTextStyling,
  validateRequestedTuneParams,
  validateVariantDistinctness,
  validateVariantRootContract,
  validateVariantVisibleCopy,
} from './live-e2e/agents/llm-agent.mjs';
import {
  buildSveltePropTextValues,
  htmlToJsx,
  normalizeVariantOutput,
  substituteLiveTextWithProps,
  svelteCssForVariant,
} from './live-e2e/agent.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_SOURCE = readFileSync(join(__dirname, 'live-e2e/agent.mjs'), 'utf-8');
const E2E_SOURCE = readFileSync(join(__dirname, 'live-e2e.test.mjs'), 'utf-8');
const PREACTIONS_SOURCE = readFileSync(join(__dirname, 'live-e2e/preactions.mjs'), 'utf-8');

describe('live-e2e agent output translation', () => {
  it('can restore preActions after an LLM/HMR reload without retracing before reload', () => {
    assert.match(
      PREACTIONS_SOURCE,
      /const reloadPreActions = opts\.reloadPreActions \?\? preActions;/,
      'robust cycling should distinguish immediate retrace preActions from reload recovery preActions',
    );
    assert.match(
      E2E_SOURCE,
      /reloadPreActions: fixture\.runtime\.rerunPreActionsAfterCyclingReload \? fixture\.runtime\.preActions : undefined/,
      'stateful fixtures need a dedicated reload-only preAction recovery path',
    );
    assert.match(
      PREACTIONS_SOURCE,
      /return \{ reloaded: true \};/,
      'robust cycling should report when it used a page reload',
    );
    assert.match(
      E2E_SOURCE,
      /resetStateProbeBaselineAfterCyclingReload/,
      'stateful probes should be able to reset their mount baseline after a harness reload',
    );
  });

  it('forwards deferred Svelte accept events into the direct accept helper', () => {
    assert.match(
      AGENT_SOURCE,
      /deferSourceWrite: event\.deferSourceWrite === true/,
      'the E2E/DeepSeek harness must preserve browser-requested deferred Svelte accepts',
    );
    assert.match(
      AGENT_SOURCE,
      /if \(!discard && deferSourceWrite\) args\.push\('--defer-source-write'\);/,
      'direct live-accept calls in the E2E harness must pass --defer-source-write',
    );
  });

  it('rejects duplicate-looking variant structures before DeepSeek writes preview files', () => {
    assert.equal(
      validateVariantDistinctness({
        variants: [
          { innerHtml: '<article class="expense-row" data-variant="1"><strong>Design snack</strong><span>$12</span></article>' },
          { innerHtml: '<article class="expense-row" data-variant="2"><strong>Design snack</strong><span>$12</span></article>' },
        ],
      }),
      'variant 2 has the same visual HTML structure as variant 1; variants must differ in visible structure/classes, not only params or inert attributes',
    );
    assert.equal(
      validateVariantDistinctness({
        variants: [
          { innerHtml: '<article class="expense-row expense-row--compact"><strong>Design snack</strong><span>$12</span></article>' },
          { innerHtml: '<article class="expense-row expense-row--stacked"><strong>Design snack</strong><span>$12</span></article>' },
        ],
      }),
      null,
    );
    assert.equal(
      validateVariantDistinctness({
        variants: [
          { innerHtml: '<h1 class="hero-title"><span class="hero-title__text hero-title__text--bold">Vite 8 Fixture</span></h1>' },
          { innerHtml: '<h1 class="hero-title"><span class="hero-title__text hero-title__text--quiet">Vite 8 Fixture</span></h1>' },
        ],
      }),
      null,
    );
  });

  it('retries replace variants that drop the picked root tag or class contract', () => {
    const element = { outerHTML: '<h1 class="hero-title">Vite 8 Fixture</h1>' };
    assert.equal(
      validateVariantRootContract(
        { variants: [{ innerHtml: '<h2 class="hero-title">Vite 8 Fixture</h2>' }] },
        element,
      ),
      'variant 0 changed the picked root tag; expected <h1>, got <h2>',
    );
    assert.equal(
      validateVariantRootContract(
        { variants: [{ innerHtml: '<h1>Vite 8 Fixture</h1>' }] },
        element,
      ),
      'variant 0 changed the picked root class attribute; expected class="hero-title", got class="". Keep the root class exactly unchanged and move variant-specific classes to child spans/elements.',
    );
    assert.equal(
      validateVariantRootContract(
        { variants: [{ innerHtml: '<h1 class="hero-title"><span>Vite 8 Fixture</span></h1>' }] },
        element,
      ),
      null,
    );
  });

  it('ignores Svelte compiler classes when checking the root class contract', () => {
    assert.equal(
      validateVariantRootContract(
        { variants: [{ innerHtml: '<span class="open-count"><span>2</span> <span>offen</span></span>' }] },
        { outerHTML: '<span class="open-count svelte-1uha8ag"><span>2</span> <span>offen</span></span>' },
        { ignoreSvelteScopedClasses: true, allowAdditionalRootClasses: true },
      ),
      null,
    );
    assert.equal(
      validateVariantRootContract(
        { variants: [{ innerHtml: '<span class="open-count open-count--v1"><span>2</span> <span>offen</span></span>' }] },
        { outerHTML: '<span class="open-count svelte-1uha8ag"><span>2</span> <span>offen</span></span>' },
        { ignoreSvelteScopedClasses: true, allowAdditionalRootClasses: true },
      ),
      null,
    );
    assert.equal(
      validateVariantRootContract(
        { variants: [{ innerHtml: '<span class="open-count--v1"><span>2</span> <span>offen</span></span>' }] },
        { outerHTML: '<span class="open-count svelte-1uha8ag"><span>2</span> <span>offen</span></span>' },
        { ignoreSvelteScopedClasses: true, allowAdditionalRootClasses: true },
      ),
      'variant 0 changed the picked root class attribute; expected to keep class token(s) "open-count", got class="open-count--v1". Keep every original root class token and move replacement classes to child spans/elements.',
    );
  });

  it('repairs missing Svelte root class tokens while preserving generated modifiers', () => {
    const parsed = {
      variants: [
        { innerHtml: '<span class="count-pill count-pill--emphasize"><span>2</span> <span>offen</span></span>' },
      ],
    };

    repairSvelteVariantRootClasses(
      parsed,
      { outerHTML: '<span class="count-pill open-count svelte-1uha8ag"><span>2</span> <span>offen</span></span>' },
    );

    assert.equal(
      parsed.variants[0].innerHtml,
      '<span class="count-pill open-count count-pill--emphasize"><span>2</span> <span>offen</span></span>',
    );
    assert.equal(
      validateVariantRootContract(
        parsed,
        { outerHTML: '<span class="count-pill open-count svelte-1uha8ag"><span>2</span> <span>offen</span></span>' },
        { ignoreSvelteScopedClasses: true, allowAdditionalRootClasses: true },
      ),
      null,
    );
  });

  it('retries when a prompt explicitly requests Tune params but the model omits them', () => {
    assert.equal(
      validateRequestedTuneParams(
        { variants: [{ innerHtml: '<p>One</p>', params: [] }] },
        { freeformPrompt: 'Include tunable params: one range, one steps/radio, and one toggle so the Tune panel is available.' },
      ),
      'prompt requested tunable params, but variants emitted no params',
    );
    assert.equal(
      validateRequestedTuneParams(
        {
          variants: [
            { innerHtml: '<p>One</p>', params: [{ id: 'scale', kind: 'range', min: 1, max: 2, step: 0.1, default: 1.2, label: 'Scale' }] },
            { innerHtml: '<p>Two</p>', params: [{ id: 'tone', kind: 'steps', default: 'warm', label: 'Tone', options: [{ value: 'warm', label: 'Warm' }] }] },
            { innerHtml: '<p>Three</p>', params: [{ id: 'strong', kind: 'toggle', default: false, label: 'Strong' }] },
          ],
        },
        { freeformPrompt: 'Include tunable params: one range, one steps/radio, and one toggle so the Tune panel is available.' },
      ),
      null,
    );
  });

  it('retries text-styling prompts when generated hooks do not receive visible text CSS', () => {
    const event = {
      freeformPrompt: 'The visible text itself must change: use font-size, font-weight, color, letter spacing, or uppercase treatment.',
      element: {
        outerHTML: '<span class="count-pill open-count"><span class="count-pill__num">1</span> <span class="count-pill__label">offen</span></span>',
      },
    };

    assert.equal(
      validateRequestedTextStyling(
        {
          scopedCss: '.count-pill[data-p-weight] .count-num--v2, .count-num--v2 { font-weight: 700; }',
          variants: [
            { innerHtml: '<span class="count-pill open-count"><span class="count-pill__num count-num--v2">1</span> <span class="count-pill__label">offen</span></span>' },
          ],
        },
        event,
      ),
      'variant 0 prompt asks for visible text styling, but none of its generated classes (count-num--v2) have visible text-affecting scopedCss rules',
    );

    assert.equal(
      validateRequestedTextStyling(
        {
          scopedCss: '.count-pill .count-num--v2 { color: #ffb000; font-size: 18px; }',
          variants: [
            { innerHtml: '<span class="count-pill open-count"><span class="count-pill__num count-num--v2">1</span> <span class="count-pill__label">offen</span></span>' },
          ],
        },
        event,
      ),
      null,
    );
  });

  it('rejects variants that remove visible whitespace between inline text runs', () => {
    assert.equal(
      validateVariantVisibleCopy(
        { variants: [{ innerHtml: '<span><span>1</span><span>offen</span></span>' }] },
        { textContent: '1 offen' },
      ),
      'variant 0 changed visible copy; expected to include "1 offen", got "1offen"',
    );
    assert.equal(
      validateVariantVisibleCopy(
        { variants: [{ innerHtml: '<span><span>1</span><span> offen</span></span>' }] },
        { textContent: '1 offen' },
      ),
      'variant 0 changed visible copy; expected to include "1 offen", got "1offen"',
    );
    assert.equal(
      validateVariantVisibleCopy(
        { variants: [{ innerHtml: '<span><span>1</span> <span>offen</span></span>' }] },
        { textContent: '1 offen' },
      ),
      null,
    );
  });

  it('allows layout-separated row/card copy when element text nodes compact together', () => {
    assert.equal(
      validateVariantVisibleCopy(
        { variants: [{ innerHtml: '<article class="expense-row"><strong>Design snack approved</strong><span>$12</span></article>' }] },
        {
          textContent: 'Design snack approved $12',
          outerHTML: '<article class="expense-row"><strong>Design snack approved</strong><span>$12</span></article>',
        },
      ),
      null,
    );
    assert.equal(
      validateVariantVisibleCopy(
        { variants: [{ innerHtml: '<article class="movie-card"><span>No poster</span><h3>Castle in the Sky</h3><p><span>1986</span><span>·</span><span>95</span></p></article>' }] },
        {
          textContent: 'No poster Castle in the Sky 1986 · 95',
          outerHTML: '<article class="movie-card"><span>No poster</span><h3>Castle in the Sky</h3><p><span>1986</span><span>·</span><span>95</span></p></article>',
        },
      ),
      null,
    );
  });

  it('converts HTML class and inline style attributes to JSX syntax', () => {
    const jsx = htmlToJsx(
      '<h1 class="hero-title" style="--p-scale:1; font-size:2.25rem; font-weight:700">Title</h1>',
    );

    assert.equal(
      jsx,
      '<h1 className="hero-title" style={{ "--p-scale": "1", fontSize: "2.25rem", fontWeight: "700" }}>Title</h1>',
    );
  });

  it('camel-cases vendor-prefixed style properties', () => {
    const jsx = htmlToJsx(
      '<h1 class="hero-title" style="-webkit-background-clip:text; background-clip:text; color:transparent">Title</h1>',
    );

    assert.equal(
      jsx,
      '<h1 className="hero-title" style={{ WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>Title</h1>',
    );
  });

  it('keeps semicolons inside quoted and parenthesized style values', () => {
    const jsx = htmlToJsx(
      `<h1 class="hero-title" style='content:"a;b"; background-image:url("foo;bar"); font-size:1rem'>Title</h1>`,
    );

    assert.equal(
      jsx,
      `<h1 className="hero-title" style={{ content: "\\"a;b\\"", backgroundImage: "url(\\"foo;bar\\")", fontSize: "1rem" }}>Title</h1>`,
    );
  });

  it('does not rewrite class inside data-class attributes', () => {
    const jsx = htmlToJsx('<h1 data-class="hero" class="hero-title">Title</h1>');

    assert.equal(jsx, '<h1 data-class="hero" className="hero-title">Title</h1>');
  });

  it('hoists model inline styles into variant-scoped CSS', () => {
    const output = normalizeVariantOutput(
      {
        scopedCss: '',
        variants: [
          {
            innerHtml: '<h1 class="hero-title" style="color:red; font-weight:700">Title</h1>',
          },
          {
            innerHtml: `<h1 class="hero-title" style='content:"a;b"; background-image:url("foo;bar")'>Title</h1>`,
          },
        ],
      },
      { styleMode: 'scoped' },
    );

    assert.equal(
      output.variants[0].innerHtml,
      '<h1 data-impeccable-hoist-id="1" class="hero-title">Title</h1>',
    );
    assert.equal(
      output.variants[1].innerHtml,
      '<h1 data-impeccable-hoist-id="1" class="hero-title">Title</h1>',
    );
    assert.match(output.scopedCss, /@scope \(\[data-impeccable-variant="1"\]\)/);
    assert.match(output.scopedCss, /:scope \[data-impeccable-hoist-id="1"\]\s*\{/);
    assert.match(output.scopedCss, /color: red;/);
    assert.match(output.scopedCss, /font-weight: 700;/);
    assert.match(output.scopedCss, /content: "a;b";/);
    assert.match(output.scopedCss, /background-image: url\("foo;bar"\);/);
  });

  it('hoists styles split across multiple lines', () => {
    const output = normalizeVariantOutput(
      {
        scopedCss: '',
        variants: [
          {
            innerHtml: '<h1 class="hero-title" style="\n  color: red;\n  font-size: 2rem;\n">Title</h1>',
          },
        ],
      },
      { styleMode: 'scoped' },
    );

    assert.equal(
      output.variants[0].innerHtml,
      '<h1 data-impeccable-hoist-id="1" class="hero-title">Title</h1>',
    );
    assert.match(output.scopedCss, /color: red;/);
    assert.match(output.scopedCss, /font-size: 2rem;/);
  });

  it('binds hoisted rules to the element the style was on, not the variant root', () => {
    const output = normalizeVariantOutput(
      {
        scopedCss: '',
        variants: [
          {
            innerHtml: '<h1 class="hero-title"><span style="color:red; transform:scale(1.1)">Title</span></h1>',
          },
        ],
      },
      { styleMode: 'scoped' },
    );

    assert.equal(
      output.variants[0].innerHtml,
      '<h1 class="hero-title"><span data-impeccable-hoist-id="1">Title</span></h1>',
    );
    assert.match(output.scopedCss, /:scope \[data-impeccable-hoist-id="1"\]\s*\{/);
    assert.match(output.scopedCss, /color: red;/);
    assert.match(output.scopedCss, /transform: scale\(1\.1\);/);
  });

  it('emits a separate rule per styled element inside one variant', () => {
    const output = normalizeVariantOutput(
      {
        scopedCss: '',
        variants: [
          {
            innerHtml: '<h1 style="color:red"><span style="font-weight:700">Title</span></h1>',
          },
        ],
      },
      { styleMode: 'scoped' },
    );

    assert.match(output.scopedCss, /:scope \[data-impeccable-hoist-id="1"\]\s*\{[^}]*color: red;/);
    assert.match(output.scopedCss, /:scope \[data-impeccable-hoist-id="2"\]\s*\{[^}]*font-weight: 700;/);
  });

  it('keeps Svelte component-style CSS instead of dropping it as non-variant CSS', () => {
    const css = [
      '.expense-row[data-polish="rhythm"] { padding: 18px; }',
      '.expense-row[data-polish="hierarchy"] { font-weight: 800; }',
      '[data-p-accent] .expense-row { border-left: 4px solid gold; }',
      '@scope ([data-impeccable-variant="1"]) {',
      '  :scope > * { --impeccable-variant-ready: 1; }',
      '}',
    ].join('\n');

    const output = svelteCssForVariant(css, 1, 'article');

    assert.match(output, /\.expense-row\[data-polish="rhythm"\]\s*\{/);
    assert.match(output, /\.expense-row\[data-polish="hierarchy"\]\s*\{/);
    assert.match(output, /\[data-p-accent\] \.expense-row\s*\{/);
    assert.match(output, /--impeccable-variant-ready:\s*1/);
    assert.doesNotMatch(output, /data-impeccable-variant/);
    assert.doesNotMatch(output, /@scope/);
  });

  it('still extracts legacy variant-wrapper CSS for Svelte component variants', () => {
    const css = [
      '@scope ([data-impeccable-variant="1"]) {',
      '  :scope > article { color: red; }',
      '}',
      '@scope ([data-impeccable-variant="2"]) {',
      '  :scope > article { font-weight: 900; }',
      '  :scope[data-p-face="mono"] > article { font-family: ui-monospace, monospace; }',
      '}',
    ].join('\n');

    const output = svelteCssForVariant(css, 2, 'article');

    assert.match(output, /article\s*\{\s*font-weight:\s*900;/);
    assert.match(output, /article\s*\{\s*font-family:\s*ui-monospace,\s*monospace;/);
    assert.match(output, /--impeccable-variant-ready:\s*1/);
    assert.doesNotMatch(output, /color:\s*red/);
    assert.doesNotMatch(output, /data-impeccable-variant/);
    assert.doesNotMatch(output, /@scope/);
  });

  it('does not leave empty Svelte :global() selectors after accepting variant CSS', () => {
    const css = [
      ':global([data-impeccable-variant="3"]) .expense-row { flex-direction: column; }',
      ':global([data-impeccable-variant="3"] .expense-amount) { font-weight: 800; }',
      '@scope ([data-impeccable-variant="3"]) {',
      '  :scope > article { border-color: gold; }',
      '}',
    ].join('\n');

    const output = svelteCssForVariant(css, 3, 'article');

    assert.match(output, /\.expense-row\s*\{\s*flex-direction:\s*column;/);
    assert.match(output, /:global\(\.expense-amount\)\s*\{\s*font-weight:\s*800;/);
    assert.match(output, /article\s*\{\s*border-color:\s*gold;/);
    assert.doesNotMatch(output, /:global\(\s*\)/);
    assert.doesNotMatch(output, /data-impeccable-variant/);
  });

  it('maps mixed Svelte dynamic/static text without dropping the static label', () => {
    const contract = [{ prop: 'length', expr: 'expenses.length' }];
    const propValues = buildSveltePropTextValues(
      '<span class="open-count">{expenses.length} offen</span>',
      '<span class="open-count svelte-1uha8ag">1 offen</span>',
      contract,
    );

    assert.equal(propValues.get('length'), '1');
    assert.equal(
      substituteLiveTextWithProps(
        '<span class="open-count"><span class="variant-text">1 offen</span></span>',
        contract,
        propValues,
      ),
      '<span class="open-count"><span class="variant-text">{length} offen</span></span>',
    );
  });

  it('maps split Svelte dynamic/static text without dropping the state value', () => {
    const contract = [{ prop: 'length', expr: 'expenses.length' }];
    const propValues = buildSveltePropTextValues(
      [
        '<span data-testid="open-count">',
        '  <span>{expenses.length}</span>',
        '  <span>offen</span>',
        '</span>',
      ].join('\n'),
      '<span data-testid="open-count"><span>2</span> <span>offen</span></span>',
      contract,
    );

    assert.equal(propValues.get('length'), '2');
    assert.equal(
      substituteLiveTextWithProps(
        '<span data-testid="open-count"><span class="num">2</span><span class="label">offen</span></span>',
        contract,
        propValues,
      ),
      '<span data-testid="open-count"><span class="num">{length}</span><span class="label">offen</span></span>',
    );
  });

  it('maps Svelte props through block directives without shifting hidden branch text', () => {
    const originalMarkup = [
      '<article class="movie-card">',
      '  <div class="movie-card__poster">',
      '    {#if movie.posterUrl}',
      '      <img src={movie.posterUrl} alt="" />',
      '    {:else}',
      '      <span>No poster</span>',
      '    {/if}',
      '  </div>',
      '  <div class="movie-card__body">',
      '    <h3 class="movie-card__title">{movie.title}</h3>',
      '    <p class="movie-card__meta">',
      '      <span>{movie.year}</span>',
      '      <span>·</span>',
      '      <span>{movie.rating}</span>',
      '    </p>',
      '  </div>',
      '</article>',
    ].join('\n');
    const liveMarkup = [
      '<article class="movie-card svelte-1tcthvq">',
      '  <div class="movie-card__poster svelte-1tcthvq"><img src="https://image.tmdb.org/t/p/w600/poster.jpg" alt=""></div>',
      '  <div class="movie-card__body svelte-1tcthvq">',
      '    <h3 class="movie-card__title svelte-1tcthvq">Castle in the Sky</h3>',
      '    <p class="movie-card__meta svelte-1tcthvq"><span>1986</span><span>·</span><span>95</span></p>',
      '  </div>',
      '</article>',
    ].join('\n');
    const contract = [
      { prop: 'posterUrl', expr: 'movie.posterUrl' },
      { prop: 'title', expr: 'movie.title' },
      { prop: 'year', expr: 'movie.year' },
      { prop: 'rating', expr: 'movie.rating' },
    ];

    const values = buildSveltePropTextValues(originalMarkup, liveMarkup, contract);
    assert.equal(values.get('title'), 'Castle in the Sky');
    assert.equal(values.get('year'), '1986');
    assert.equal(values.get('rating'), '95');
    assert.equal(values.has('posterUrl'), false);

    const variantMarkup = '<article class="movie-card"><h3>Castle in the Sky</h3><p><span>1986</span><span>·</span><span>95</span></p></article>';
    assert.equal(
      substituteLiveTextWithProps(variantMarkup, contract, values),
      '<article class="movie-card"><h3>{title}</h3><p><span>{year}</span><span>·</span><span>{rating}</span></p></article>',
    );
  });

  it('targets only the styled element when same-tag siblings are present', () => {
    const output = normalizeVariantOutput(
      {
        scopedCss: '',
        variants: [
          {
            innerHtml: '<div><span>plain</span><span style="color:red">styled</span></div>',
          },
        ],
      },
      { styleMode: 'scoped' },
    );

    const hoistMatches = output.variants[0].innerHtml.match(/data-impeccable-hoist-id=/g) || [];
    assert.equal(hoistMatches.length, 1, 'only the styled span should carry the hoist attribute');
    assert.match(
      output.variants[0].innerHtml,
      /<span data-impeccable-hoist-id="1">styled<\/span>/,
    );
    assert.match(output.variants[0].innerHtml, /<span>plain<\/span>/);
    assert.match(output.scopedCss, /:scope \[data-impeccable-hoist-id="1"\]\s*\{[^}]*color: red;/);
  });

  it('handles > inside a quoted attribute value without losing the style', () => {
    const output = normalizeVariantOutput(
      {
        scopedCss: '',
        variants: [
          {
            innerHtml: '<h1 aria-label="x > y" style="color:red">Title</h1>',
          },
        ],
      },
      { styleMode: 'scoped' },
    );

    assert.match(output.variants[0].innerHtml, /aria-label="x > y"/);
    assert.match(output.variants[0].innerHtml, /data-impeccable-hoist-id="1"/);
    assert.doesNotMatch(output.variants[0].innerHtml, /style=/);
    assert.match(output.scopedCss, /color: red;/);
  });

  it('emits the astro-global-prefixed selector shape when styleMode requests it', () => {
    const output = normalizeVariantOutput(
      {
        scopedCss: '',
        variants: [
          { innerHtml: '<h1 style="color:red">Title</h1>' },
        ],
      },
      { styleMode: 'astro-global-prefixed' },
    );

    assert.match(
      output.scopedCss,
      /\[data-impeccable-variant="1"\] \[data-impeccable-hoist-id="1"\] \{/,
    );
    assert.doesNotMatch(output.scopedCss, /@scope/);
  });

  it('fills missing base variant rules when a model emits only param-conditioned CSS', () => {
    const output = normalizeVariantOutput(
      {
        scopedCss: [
          '@scope ([data-impeccable-variant="1"]) { :scope > h1 { color: blue; } }',
          '@scope ([data-impeccable-variant="2"][data-p-uppercase]) { :scope > h1 { text-transform: uppercase; } }',
        ].join('\n'),
        variants: [
          { innerHtml: '<h1 class="hero-title">One</h1>' },
          { innerHtml: '<h1 class="hero-title">Two</h1>' },
        ],
      },
      { styleMode: 'scoped' },
    );

    assert.match(output.scopedCss, /@scope \(\[data-impeccable-variant="2"\]\)/);
    assert.match(output.scopedCss, /--impeccable-variant-ready: 1;/);
    assert.match(output.scopedCss, /@scope \(\[data-impeccable-variant="2"\]\[data-p-uppercase\]\)/);
  });

  it('returns the original output untouched when no inline styles are present', () => {
    const original = {
      scopedCss: '@scope ([data-impeccable-variant="1"]) { :scope > h1 { color: blue; } }',
      variants: [{ innerHtml: '<h1 class="hero-title">Title</h1>' }],
    };
    const result = normalizeVariantOutput(original, { styleMode: 'scoped' });
    assert.equal(result, original);
  });
});
