import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MANUAL_EDIT_SYSTEM_INSTRUCTIONS,
  VARIANT_SYSTEM_INSTRUCTIONS,
  createLlmAgent,
  parseManualEditResponse,
  parseVariantResponse,
  resolveLlmAgentConfig,
  validateManualEditCoverage,
  validateVariantMaterialChange,
  validateVariantVisibleCopy,
} from './live-e2e/agents/llm-agent.mjs';

describe('live-e2e LLM agent provider config', () => {
  it('defaults to Anthropic and Claude Haiku when no keys are present', () => {
    const config = resolveLlmAgentConfig({}, {});

    assert.equal(config.provider, 'anthropic');
    assert.equal(config.model, 'claude-haiku-4-5');
    assert.equal(config.requiredEnv, 'ANTHROPIC_API_KEY');
    assert.equal(config.apiKey, undefined);
    assert.equal(config.baseURL, undefined);
  });

  it('prefers Anthropic when both provider keys are present', () => {
    const config = resolveLlmAgentConfig({}, {
      ANTHROPIC_API_KEY: 'claude-key',
      DEEPSEEK_API_KEY: 'deepseek-key',
    });

    assert.equal(config.provider, 'anthropic');
    assert.equal(config.model, 'claude-haiku-4-5');
    assert.equal(config.requiredEnv, 'ANTHROPIC_API_KEY');
    assert.equal(config.apiKey, 'claude-key');
    assert.equal(config.baseURL, undefined);
  });

  it('falls back to DeepSeek V4 Flash when only DEEPSEEK_API_KEY is present', () => {
    const config = resolveLlmAgentConfig({}, {
      DEEPSEEK_API_KEY: 'test-key',
    });

    assert.equal(config.provider, 'deepseek');
    assert.equal(config.model, 'deepseek-v4-flash');
    assert.equal(config.requiredEnv, 'DEEPSEEK_API_KEY');
    assert.equal(config.apiKey, 'test-key');
    assert.equal(config.baseURL, 'https://api.deepseek.com/anthropic');
  });

  it('explicitly selects DeepSeek over Anthropic', () => {
    const config = resolveLlmAgentConfig({}, {
      IMPECCABLE_E2E_LLM_PROVIDER: 'deepseek',
      ANTHROPIC_API_KEY: 'claude-key',
      DEEPSEEK_API_KEY: 'deepseek-key',
    });

    assert.equal(config.provider, 'deepseek');
    assert.equal(config.model, 'deepseek-v4-flash');
    assert.equal(config.requiredEnv, 'DEEPSEEK_API_KEY');
    assert.equal(config.apiKey, 'deepseek-key');
    assert.equal(config.baseURL, 'https://api.deepseek.com/anthropic');
  });

  it('allows explicit model and base URL overrides', () => {
    const config = resolveLlmAgentConfig(
      { model: 'custom-model', baseURL: 'https://example.test/anthropic' },
      {
        IMPECCABLE_E2E_LLM_PROVIDER: 'deepseek',
        IMPECCABLE_E2E_LLM_MODEL: 'ignored-model',
        DEEPSEEK_API_KEY: 'test-key',
      },
    );

    assert.equal(config.model, 'custom-model');
    assert.equal(config.baseURL, 'https://example.test/anthropic');
  });

  it('allows the DeepSeek API base URL to come from env', () => {
    const config = resolveLlmAgentConfig({}, {
      IMPECCABLE_E2E_LLM_PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'test-key',
      DEEPSEEK_API_BASE_URL: 'https://proxy.example.test/anthropic',
    });

    assert.equal(config.baseURL, 'https://proxy.example.test/anthropic');
  });

  it('rejects unsupported providers', () => {
    assert.throws(
      () => resolveLlmAgentConfig({}, { IMPECCABLE_E2E_LLM_PROVIDER: 'other' }),
      /Unsupported IMPECCABLE_E2E_LLM_PROVIDER: other/,
    );
  });
});

describe('live-e2e LLM agent createLlmAgent', () => {
  it('uses an explicit opts.config without re-reading env', async () => {
    const agent = await createLlmAgent({
      config: {
        provider: 'anthropic',
        model: 'test-model',
        apiKey: 'test-key',
        baseURL: undefined,
        requiredEnv: 'ANTHROPIC_API_KEY',
      },
    });
    assert.ok(agent, 'agent should be returned when config.apiKey is set');
    assert.equal(typeof agent.generateVariants, 'function');
    assert.equal(typeof agent.applyManualEdits, 'function');
  });

  it('returns null when the resolved config has no apiKey', async () => {
    const agent = await createLlmAgent({
      config: {
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        apiKey: undefined,
        baseURL: 'https://api.deepseek.com/anthropic',
        requiredEnv: 'DEEPSEEK_API_KEY',
      },
    });
    assert.equal(agent, null);
  });
});

describe('live-e2e LLM agent parseManualEditResponse', () => {
  const validParsed = {
    status: 'done',
    appliedEntryIds: ['cafebabe'],
    failed: [],
    files: ['src/App.jsx'],
    notes: [],
    sourceEdits: [
      {
        entryId: 'cafebabe',
        file: 'src/App.jsx',
        line: 3,
        originalText: 'Old',
        newText: 'New',
      },
    ],
  };

  it('parses a well-formed manual edit response', () => {
    const parsed = parseManualEditResponse(JSON.stringify(validParsed));
    assert.deepEqual(parsed, validParsed);
  });

  it('defaults optional arrays for production-shaped error responses', () => {
    const parsed = parseManualEditResponse(JSON.stringify({ status: 'error' }));

    assert.deepEqual(parsed, {
      status: 'error',
      appliedEntryIds: [],
      failed: [],
      files: [],
      notes: [],
      sourceEdits: [],
    });
  });

  it('rejects non-array sourceEdits', () => {
    assert.throws(
      () => parseManualEditResponse(JSON.stringify({ status: 'done', sourceEdits: 'nope' })),
      /manual edit sourceEdits must be an array/,
    );
  });

  it('rejects malformed source edit entries', () => {
    assert.throws(
      () => parseManualEditResponse(JSON.stringify({
        status: 'done',
        sourceEdits: [{ entryId: 'a', file: 'src/App.jsx', originalText: 'Old' }],
      })),
      /sourceEdits\[0\]\.newText missing or empty/,
    );
  });
});

describe('live-e2e LLM agent manual edit prompt', () => {
  it('tells the model to preserve typed source values during display-copy edits', () => {
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /preserve numeric, boolean, and structured source values/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /visible copy adds words around an integer/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /originalText="\{String\(item\.count\)\}"/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /originalText="\{item\.count\}"/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /op\.sourceHint\.file and op\.sourceHint\.line/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /Missing sourceHint is not a failure/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /objectKeyMatches/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /data object or mapped list item/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /hinted leaf text edits/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /Do not rewrite the parent section/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /Never use DOM outerHTML as sourceEdit\.originalText/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /mixed markup that renders one visible phrase/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /lookup key/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /paired count\/value/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /old lookup key/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /do not edit the renderer expression/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /count\/value op arrives without the label op/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /restore the typed numeric value without quotes/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /replace the enclosing source literal or map entry/);
  });

  it('tells the model to cover every op in multi-leaf applied entries', () => {
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /multiple ops/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /cover every op\.newText/);
  });

  it('tells the model not to return source edits for failed entries', () => {
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /Never return sourceEdits for failed, omitted, or unreported entries/);
  });

  it('tells the model manual Apply is non-interactive', () => {
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /user already clicked Apply/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /Never ask what to do with staged edits/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /Start applying and return JSON/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /Manual copy edits are first-class work/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /looks temporary, experimental, or unusual/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /never discard it, clean it up, or redirect the user to the visual picker/);
    assert.doesNotMatch(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /What would you like to do with these changes/i);
  });

  it('tells the model chunked manual Apply events are complete current work units', () => {
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /multiple small chunks/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /complete current work unit/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /poll again for later chunks/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /Do not fail entries just because later staged edits are not present in this chunk/);
  });

  it('tells the model compact manual Apply events load full evidence out-of-band', () => {
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /Track A poll events may be compact/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /evidencePath is present/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /loaded batch as authoritative/);
  });
});

describe('live-e2e LLM agent manual edit coverage validation', () => {
  const batch = {
    entries: [
      {
        id: 'entry-a',
        ops: [
          { newText: 'Five-leaf stress title applied' },
          { originalText: '7', newText: '7 workshop seats remain' },
        ],
      },
    ],
  };

  it('rejects applied multi-op entries when a staged leaf is missing from sourceEdits', () => {
    const error = validateManualEditCoverage(
      {
        status: 'done',
        appliedEntryIds: ['entry-a'],
        sourceEdits: [
          {
            entryId: 'entry-a',
            file: 'src/App.jsx',
            originalText: 'Old',
            newText: 'Five-leaf stress title applied',
          },
        ],
      },
      batch,
    );

    assert.match(error, /no sourceEdit newText contains staged copy/);
    assert.match(error, /7 workshop seats remain/);
  });

  it('rejects sourceEdits for entries not listed in appliedEntryIds', () => {
    const error = validateManualEditCoverage(
      {
        status: 'partial',
        appliedEntryIds: ['entry-a'],
        failed: [{ entryId: 'entry-b', reason: 'conflict' }],
        sourceEdits: [
          {
            entryId: 'entry-b',
            file: 'src/App.jsx',
            originalText: 'Old',
            newText: 'Leaked failed-entry copy',
          },
        ],
      },
      {
        entries: [
          { id: 'entry-a', ops: [{ newText: 'Applied copy' }] },
          { id: 'entry-b', ops: [{ newText: 'Leaked failed-entry copy' }] },
        ],
      },
    );

    assert.match(error, /not in appliedEntryIds/);
  });

  it('rejects unapplied entries when every op has a sourceHint', () => {
    const error = validateManualEditCoverage(
      {
        status: 'error',
        appliedEntryIds: [],
        failed: [{ entryId: 'entry-a', reason: 'could not resolve source' }],
        sourceEdits: [],
      },
      {
        entries: [
          {
            id: 'entry-a',
            ops: [
              {
                newText: 'Five-leaf stress title applied',
                sourceHint: { file: 'src/App.jsx', line: 12 },
              },
              {
                newText: 'Five-leaf stress hook applied.',
                sourceHint: { file: 'src/App.jsx', line: 13 },
              },
            ],
          },
        ],
      },
    );

    assert.match(error, /sourceHint\.file and sourceHint\.line for every op/);
  });

  it('rejects failed entries when candidates identify dynamic source data without sourceHint', () => {
    const error = validateManualEditCoverage(
      {
        status: 'partial',
        appliedEntryIds: [],
        failed: [{ entryId: 'entry-a', reason: 'sourceHint missing' }],
        sourceEdits: [],
      },
      {
        entries: [
          {
            id: 'entry-a',
            ops: [
              {
                ref: 'body>section.foundation-grid>article:nth-of-type(2)>span',
                originalText: 'Color & Contrast',
                newText: 'Color Systems',
                nearbyEditableTexts: [{ text: 'Accessible palettes' }],
              },
              {
                ref: 'body>section.foundation-grid>article:nth-of-type(2)>p',
                originalText: 'Accessible palettes',
                newText: 'Accessible contrast tokens',
                nearbyEditableTexts: [{ text: 'Color & Contrast' }],
              },
            ],
          },
        ],
        candidates: [
          {
            entryId: 'entry-a',
            ref: 'body>section.foundation-grid>article:nth-of-type(2)>span',
            originalText: 'Color & Contrast',
            textMatches: [{ file: 'src/App.jsx', line: 3, kind: 'text' }],
            objectKeyMatches: [],
            contextTextMatches: [{ file: 'src/App.jsx', line: 3, kind: 'context' }],
          },
          {
            entryId: 'entry-a',
            ref: 'body>section.foundation-grid>article:nth-of-type(2)>p',
            originalText: 'Accessible palettes',
            textMatches: [{ file: 'src/App.jsx', line: 3, kind: 'text' }],
            objectKeyMatches: [],
            contextTextMatches: [{ file: 'src/App.jsx', line: 3, kind: 'context' }],
          },
        ],
      },
    );

    assert.match(error, /candidate source evidence without sourceHint/);
    assert.match(error, /text\/objectKey\/context candidates/);
  });

  it('gives data-map guidance for failed rendered counts without sourceHint', () => {
    const error = validateManualEditCoverage(
      {
        status: 'partial',
        appliedEntryIds: [],
        failed: [{ entryId: 'entry-a', reason: 'sourceHint missing' }],
        sourceEdits: [],
      },
      {
        entries: [
          {
            id: 'entry-a',
            ops: [{ originalText: '17', newText: 'many seats' }],
          },
        ],
        candidates: [
          {
            entryId: 'entry-a',
            objectKeyMatches: [{ file: 'src/data.js', key: 'Seats' }],
          },
        ],
      },
    );

    assert.match(error, /rendered count\/value without sourceHint/);
    assert.match(error, /source data map or lookup value/);
    assert.match(error, /"many seats"/);
  });

  it('accepts JSX expression replacements that contain the visible staged copy', () => {
    const error = validateManualEditCoverage(
      {
        status: 'done',
        appliedEntryIds: ['entry-a'],
        sourceEdits: [
          {
            entryId: 'entry-a',
            file: 'src/App.jsx',
            originalText: 'Old title',
            newText: 'Five-leaf stress title applied',
          },
          {
            entryId: 'entry-a',
            file: 'src/App.jsx',
            originalText: '{String(workshopStats.seats)}',
            newText: '{"7 workshop seats remain"}',
          },
        ],
      },
      batch,
    );

    assert.equal(error, null);
  });

  it('rejects integer display edits that do not use a quoted display expression', () => {
    const error = validateManualEditCoverage(
      {
        status: 'done',
        appliedEntryIds: ['entry-a'],
        sourceEdits: [
          {
            entryId: 'entry-a',
            file: 'src/App.jsx',
            originalText: 'Old title',
            newText: 'Five-leaf stress title applied',
          },
          {
            entryId: 'entry-a',
            file: 'src/App.jsx',
            originalText: '{String(workshopStats.seats)}',
            newText: '7 workshop seats remain',
          },
        ],
      },
      batch,
    );

    assert.match(error, /quoted display expression/);
  });

  it('allows numeric-looking literal text edits that are not source expressions', () => {
    const error = validateManualEditCoverage(
      {
        status: 'done',
        appliedEntryIds: ['entry-a'],
        sourceEdits: [
          {
            entryId: 'entry-a',
            file: 'src/page.html',
            originalText: '7',
            newText: '7 workshop seats remain',
          },
        ],
      },
      {
        entries: [
          {
            id: 'entry-a',
            ops: [
              { originalText: '7', newText: '7 workshop seats remain' },
            ],
          },
        ],
      },
    );

    assert.equal(error, null);
  });

  it('rejects lookup-renderer edits with data-map guidance instead of display-expression guidance', () => {
    const error = validateManualEditCoverage(
      {
        status: 'done',
        appliedEntryIds: ['entry-a'],
        sourceEdits: [
          {
            entryId: 'entry-a',
            file: 'src/components/list.js',
            originalText: '${counts[item.label] || \'\'}',
            newText: '${"many seats"}',
          },
        ],
      },
      {
        entries: [
          {
            id: 'entry-a',
            ops: [
              { originalText: '17', newText: 'many seats' },
            ],
          },
        ],
      },
    );

    assert.match(error, /lookup-rendered copy/);
    assert.match(error, /source data object\/map entry/);
    assert.doesNotMatch(error, /quoted display expression/);
  });

  it('rejects paired label/count edits that leave the count lookup on the old label', () => {
    const error = validateManualEditCoverage(
      {
        status: 'done',
        appliedEntryIds: ['entry-a'],
        sourceEdits: [
          {
            entryId: 'entry-a',
            file: 'src/data.js',
            originalText: "label: 'Old label'",
            newText: "label: 'New label'",
          },
          {
            entryId: 'entry-a',
            file: 'src/data.js',
            originalText: "'Old label': 17",
            newText: "'Old label': 'many seats'",
          },
        ],
      },
      {
        entries: [
          {
            id: 'entry-a',
            ops: [
              { originalText: 'Old label', newText: 'New label' },
              { originalText: '17', newText: 'many seats' },
            ],
          },
        ],
      },
    );

    assert.match(error, /renames lookup label/);
    assert.match(error, /paired count\/lookup key/);
    assert.match(error, /new label/);
  });

  it('rejects paired label/count reverts that leave plain integer counts quoted', () => {
    const error = validateManualEditCoverage(
      {
        status: 'done',
        appliedEntryIds: ['entry-a'],
        sourceEdits: [
          {
            entryId: 'entry-a',
            file: 'src/data.js',
            originalText: "label: 'Edited label'",
            newText: "label: 'Original label'",
          },
          {
            entryId: 'entry-a',
            file: 'src/data.js',
            originalText: "'Edited label': 'many seats'",
            newText: "'Original label': '17'",
          },
        ],
      },
      {
        entries: [
          {
            id: 'entry-a',
            ops: [
              { originalText: 'Edited label', newText: 'Original label' },
              { originalText: 'many seats', newText: '17' },
            ],
          },
        ],
      },
    );

    assert.match(error, /plain integer/);
    assert.match(error, /without quotes/);
    assert.match(error, /numeric string/);
  });

  it('rejects paired label/count reverts that replace only the inner quoted string text', () => {
    const error = validateManualEditCoverage(
      {
        status: 'done',
        appliedEntryIds: ['entry-a'],
        sourceEdits: [
          {
            entryId: 'entry-a',
            file: 'src/data.js',
            originalText: "label: 'Edited label'",
            newText: "label: 'Original label'",
          },
          {
            entryId: 'entry-a',
            file: 'src/data.js',
            originalText: 'many seats',
            newText: '17',
          },
        ],
      },
      {
        entries: [
          {
            id: 'entry-a',
            ops: [
              { originalText: 'Edited label', newText: 'Original label' },
              { originalText: 'many seats', newText: '17' },
            ],
          },
        ],
      },
    );

    assert.match(error, /enclosing source literal/);
    assert.match(error, /not only the inner string text/);
  });

  it('rejects exact visible-literal edits that miss the sourceHint line', () => {
    const error = validateManualEditCoverage(
      {
        status: 'done',
        appliedEntryIds: ['entry-a'],
        sourceEdits: [
          {
            entryId: 'entry-a',
            file: 'src/pages/index.astro',
            line: 4,
            originalText: 'Astro + Vite 7 Fixture',
            newText: 'Five-leaf stress title applied',
          },
          {
            entryId: 'entry-a',
            file: 'src/App.jsx',
            originalText: '{String(workshopStats.seats)}',
            newText: '{"7 workshop seats remain"}',
          },
        ],
      },
      {
        entries: [
          {
            id: 'entry-a',
            ops: [
              {
                originalText: 'Astro + Vite 7 Fixture',
                newText: 'Five-leaf stress title applied',
                sourceHint: { file: 'src/pages/index.astro', line: 6 },
              },
              { newText: '7 workshop seats remain' },
            ],
          },
        ],
      },
    );

    assert.match(error, /sourceHint points to src\/pages\/index\.astro:6/);
  });
});

describe('live-e2e LLM agent variant prompt', () => {
  it('tells the model not to nest duplicate picked containers', () => {
    assert.match(VARIANT_SYSTEM_INSTRUCTIONS, /replacement root itself/);
    assert.match(VARIANT_SYSTEM_INSTRUCTIONS, /do not wrap a duplicate/);
  });

  it('tells the model to preserve existing visible copy', () => {
    assert.match(VARIANT_SYSTEM_INSTRUCTIONS, /PRESERVE all existing visible copy exactly/);
    assert.match(VARIANT_SYSTEM_INSTRUCTIONS, /must not rewrite titles, paragraphs, button labels/);
    assert.match(VARIANT_SYSTEM_INSTRUCTIONS, /full visible copy in one editable text node/);
    assert.match(VARIANT_SYSTEM_INSTRUCTIONS, /wrap the entire copy/);
  });

  it('tells the model not to wrap editable descendants in new structural containers', () => {
    assert.match(VARIANT_SYSTEM_INSTRUCTIONS, /PRESERVE existing class-bearing descendant elements/);
    assert.match(VARIANT_SYSTEM_INSTRUCTIONS, /do not wrap them in a new structural div/);
  });

  it('tells the model bare text variants must not be source-identical no-ops', () => {
    assert.match(VARIANT_SYSTEM_INSTRUCTIONS, /Do not return source-identical variants/);
    assert.match(VARIANT_SYSTEM_INSTRUCTIONS, /bare text element/);
    assert.match(VARIANT_SYSTEM_INSTRUCTIONS, /Accept persists a real source change/);
  });
});

describe('live-e2e LLM agent variant copy validation', () => {
  it('allows variants that preserve the picked element text', () => {
    const result = validateVariantVisibleCopy(
      {
        variants: [
          { innerHtml: '<h1 class="hero-title"><span>Manual Title Applied</span></h1>' },
        ],
      },
      { textContent: 'Manual Title Applied' },
    );

    assert.equal(result, null);
  });

  it('rejects variants that rewrite the picked element text', () => {
    const result = validateVariantVisibleCopy(
      {
        variants: [
          { innerHtml: '<h1 class="hero-title">Generated Fresh Title</h1>' },
        ],
      },
      { textContent: 'Manual Title Applied' },
    );

    assert.match(result, /changed visible copy/);
    assert.match(result, /Manual Title Applied/);
  });

  it('uses outerHTML as a fallback when textContent is absent', () => {
    const result = validateVariantVisibleCopy(
      {
        variants: [
          { innerHtml: '<section class="hero-copy"><h1>Batch Title</h1><p>Batch Body</p></section>' },
        ],
      },
      { outerHTML: '<section class="hero-copy"><h1>Batch Title</h1><p>Batch Body</p></section>' },
    );

    assert.equal(result, null);
  });

  it('rejects variants that are source-identical to the picked element', () => {
    const result = validateVariantMaterialChange(
      {
        variants: [
          { innerHtml: '<h1 class="hero-title">Manual Title Applied</h1>' },
        ],
      },
      { outerHTML: '<h1 class="hero-title">Manual Title Applied</h1>' },
    );

    assert.match(result, /source-identical/);
  });

  it('rejects bare text variants that split the copy across sibling text nodes', () => {
    const result = validateVariantMaterialChange(
      {
        variants: [
          { innerHtml: '<h1 class="title">Manual <span>Title</span></h1>' },
        ],
      },
      { outerHTML: '<h1 class="title">Manual Title</h1>' },
    );

    assert.match(result, /multiple editable text nodes/);
  });

  it('allows bare text variants that wrap the full copy in one child', () => {
    const result = validateVariantMaterialChange(
      {
        variants: [
          { innerHtml: '<h1 class="title"><span>Manual Title</span></h1>' },
        ],
      },
      { outerHTML: '<h1 class="title">Manual Title</h1>' },
    );

    assert.equal(result, null);
  });
});

describe('live-e2e LLM agent parseVariantResponse', () => {
  const validParsed = {
    scopedCss: '@scope ([data-impeccable-variant="1"]) {}',
    variants: [{ innerHtml: '<h1 class="hero-title">Title</h1>' }],
  };

  it('parses a well-formed response', () => {
    const parsed = parseVariantResponse(JSON.stringify(validParsed));
    assert.deepEqual(parsed, validParsed);
  });

  it('strips a single surrounding ```json fence', () => {
    const parsed = parseVariantResponse(
      '```json\n' + JSON.stringify(validParsed) + '\n```',
    );
    assert.deepEqual(parsed, validParsed);
  });

  it('echoes the raw payload (first 500 chars) on JSON-parse failure', () => {
    assert.throws(
      () => parseVariantResponse('not valid json {'),
      (err) => err.message.includes('First 500 chars:') && err.message.includes('not valid json {'),
    );
  });

  it('echoes the parsed payload on missing scopedCss', () => {
    const body = JSON.stringify({ variants: [{ innerHtml: '<h1>x</h1>' }] });
    assert.throws(
      () => parseVariantResponse(body),
      (err) =>
        /missing or non-string scopedCss/.test(err.message)
        && /Parsed \(first 500 chars\):/.test(err.message)
        && err.message.includes('"variants"'),
    );
  });

  it('rejects scopedCss that includes an outer style tag', () => {
    const body = JSON.stringify({
      scopedCss: '<style data-impeccable-css="SESSION_ID">@scope ([data-impeccable-variant="1"]) {}</style>',
      variants: [{ innerHtml: '<h1>x</h1>' }],
    });
    assert.throws(
      () => parseVariantResponse(body),
      /scopedCss must contain CSS rules only/,
    );
  });

  it('rejects scopedCss that would break JSX template literals', () => {
    const body = JSON.stringify({
      scopedCss: '@scope ([data-impeccable-variant="1"]) { .title::before { content: `bad`; } }',
      variants: [{ innerHtml: '<h1>x</h1>' }],
    });
    assert.throws(
      () => parseVariantResponse(body),
      /scopedCss must not contain backticks/,
    );
  });

  it('rejects scopedCss with template interpolation', () => {
    const body = JSON.stringify({
      scopedCss: '@scope ([data-impeccable-variant="1"]) { .title { color: ${bad}; } }',
      variants: [{ innerHtml: '<h1>x</h1>' }],
    });
    assert.throws(
      () => parseVariantResponse(body),
      /scopedCss must not contain template interpolation/,
    );
  });

  it('rejects malformed scopedCss before it reaches framework compilers', () => {
    const body = JSON.stringify({
      scopedCss: '@scope ([data-impeccable-variant="1"]) { .title { color: red; }',
      variants: [{ innerHtml: '<h1>x</h1>' }],
    });
    assert.throws(
      () => parseVariantResponse(body),
      /scopedCss has unbalanced CSS braces/,
    );
  });

  it('rejects variant HTML that includes its own style tag', () => {
    const body = JSON.stringify({
      scopedCss: '@scope ([data-impeccable-variant="1"]) {}',
      variants: [{ innerHtml: '<h1><style>.x{color:red}</style>x</h1>' }],
    });
    assert.throws(
      () => parseVariantResponse(body),
      /innerHtml must not include a <style> tag/,
    );
  });

  it('rejects framework-shaped variant HTML', () => {
    const body = JSON.stringify({
      scopedCss: '@scope ([data-impeccable-variant="1"]) {}',
      variants: [{ innerHtml: '<h1 className="hero-title" style={{ color: "red" }}>x</h1>' }],
    });
    assert.throws(
      () => parseVariantResponse(body),
      /must use HTML class= attributes/,
    );
  });

  it('rejects variant HTML that tries to emit wrapper scaffolding', () => {
    const body = JSON.stringify({
      scopedCss: '@scope ([data-impeccable-variant="1"]) {}',
      variants: [{ innerHtml: '<div data-impeccable-variant="1"><h1>x</h1></div>' }],
    });
    assert.throws(
      () => parseVariantResponse(body),
      /must not include Impeccable wrapper attributes/,
    );
  });

  it('echoes the parsed payload on empty variants array', () => {
    const body = JSON.stringify({ scopedCss: '', variants: [] });
    assert.throws(
      () => parseVariantResponse(body),
      (err) =>
        /variants must be a non-empty array/.test(err.message)
        && /Parsed \(first 500 chars\):/.test(err.message),
    );
  });

  it('echoes the parsed payload on empty innerHtml', () => {
    const body = JSON.stringify({ scopedCss: '', variants: [{ innerHtml: '' }] });
    assert.throws(
      () => parseVariantResponse(body),
      (err) =>
        /variants\[0\]\.innerHtml missing or empty/.test(err.message)
        && /Parsed \(first 500 chars\):/.test(err.message),
    );
  });

  it('echoes the parsed payload on non-array params', () => {
    const body = JSON.stringify({
      scopedCss: '',
      variants: [{ innerHtml: '<h1>x</h1>', params: 'not-an-array' }],
    });
    assert.throws(
      () => parseVariantResponse(body),
      (err) =>
        /variants\[0\]\.params must be an array/.test(err.message)
        && /Parsed \(first 500 chars\):/.test(err.message),
    );
  });
});
