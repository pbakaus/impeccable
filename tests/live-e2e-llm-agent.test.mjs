import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  MANUAL_EDIT_SYSTEM_INSTRUCTIONS,
  VARIANT_SYSTEM_INSTRUCTIONS,
  createLlmAgent,
  parseManualEditResponse,
  parseVariantResponse,
  progressiveVariantGuidance,
  resolveLlmAgentConfig,
  validateManualEditCoverage,
  validateManualEditPlanningCoverage,
  validateVariantMaterialChange,
  validateVariantCount,
  validateProgressiveVariantOutput,
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

describe('live-e2e LLM agent provider replay', () => {
  it('applies a generic label/count/source-key batch through the selected provider', async (t) => {
    if (process.env.IMPECCABLE_LLM_REPLAY !== '1') {
      t.skip('set IMPECCABLE_LLM_REPLAY=1 to run provider-backed manual edit replay');
      return;
    }

    const config = resolveLlmAgentConfig({
      provider: process.env.IMPECCABLE_E2E_LLM_PROVIDER || 'deepseek',
      model: process.env.IMPECCABLE_E2E_LLM_MODEL,
    });
    const agent = await createLlmAgent({ config, log: (msg) => t.diagnostic(msg) });
    if (!agent) {
      t.skip(`missing API key for ${config.provider}; cannot run provider replay`);
      return;
    }

    const tmp = createSourceKeyReplayProject('apply');
    try {
      const result = await agent.applyManualEdits(
        { id: 'manual-apply-replay', batch: sourceKeyReplayBatch('apply') },
        { tmp },
      );

      assert.equal(result.status, 'done');
      assert.deepEqual(result.appliedEntryIds, ['entry-a']);
      const data = readFileSync(join(tmp, 'src/data.js'), 'utf-8');
      const visuals = readFileSync(join(tmp, 'src/visuals.js'), 'utf-8');
      assert.match(data, /label:\s*'New Label'/);
      assert.match(data, /'New Label':\s*'007'/);
      assert.doesNotMatch(data, /'Old Label':\s*7/);
      assert.match(visuals, /'New Label':\s*'<svg><\/svg>'/);
      assert.doesNotMatch(visuals, /'Old Label':\s*'<svg><\/svg>'/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('restores a generic source-key batch through the selected provider without leaving numeric strings', async (t) => {
    if (process.env.IMPECCABLE_LLM_REPLAY !== '1') {
      t.skip('set IMPECCABLE_LLM_REPLAY=1 to run provider-backed manual edit replay');
      return;
    }

    const config = resolveLlmAgentConfig({
      provider: process.env.IMPECCABLE_E2E_LLM_PROVIDER || 'deepseek',
      model: process.env.IMPECCABLE_E2E_LLM_MODEL,
    });
    const agent = await createLlmAgent({ config, log: (msg) => t.diagnostic(msg) });
    if (!agent) {
      t.skip(`missing API key for ${config.provider}; cannot run provider replay`);
      return;
    }

    const tmp = createSourceKeyReplayProject('restore');
    try {
      const result = await agent.applyManualEdits(
        { id: 'manual-restore-replay', batch: sourceKeyReplayBatch('restore') },
        { tmp },
      );

      assert.equal(result.status, 'done');
      assert.deepEqual(result.appliedEntryIds, ['entry-a']);
      const data = readFileSync(join(tmp, 'src/data.js'), 'utf-8');
      const visuals = readFileSync(join(tmp, 'src/visuals.js'), 'utf-8');
      assert.match(data, /label:\s*'Old Label'/);
      assert.match(data, /'Old Label':\s*7/);
      assert.doesNotMatch(data, /'Old Label':\s*'7'/);
      assert.match(visuals, /'Old Label':\s*'<svg><\/svg>'/);
      assert.doesNotMatch(visuals, /'New Label':\s*'<svg><\/svg>'/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

function createSourceKeyReplayProject(mode) {
  const root = mkdtempSync(join(tmpdir(), 'impeccable-llm-replay-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  if (mode === 'restore') {
    writeFileSync(join(root, 'src/data.js'), [
      'export const cards = [',
      "  { label: 'New Label', detail: 'Stable detail' },",
      '];',
      'export const countsByLabel = {',
      "  'New Label': '007',",
      '};',
      '',
    ].join('\n'));
    writeFileSync(join(root, 'src/visuals.js'), [
      'export const visualsByLabel = {',
      "  'New Label': '<svg></svg>',",
      '};',
      '',
    ].join('\n'));
    return root;
  }
  writeFileSync(join(root, 'src/data.js'), [
    'export const cards = [',
    "  { label: 'Old Label', detail: 'Stable detail' },",
    '];',
    'export const countsByLabel = {',
    "  'Old Label': 7,",
    '};',
    '',
  ].join('\n'));
  writeFileSync(join(root, 'src/visuals.js'), [
    'export const visualsByLabel = {',
    "  'Old Label': '<svg></svg>',",
    '};',
    '',
  ].join('\n'));
  return root;
}

function sourceKeyReplayBatch(mode) {
  const restoring = mode === 'restore';
  const originalLabel = restoring ? 'New Label' : 'Old Label';
  const nextLabel = restoring ? 'Old Label' : 'New Label';
  const originalCount = restoring ? '007' : '7';
  const nextCount = restoring ? '7' : '007';
  return {
    entries: [
      {
        id: 'entry-a',
        ops: [
          {
            ref: 'label',
            originalText: originalLabel,
            newText: nextLabel,
            sourceHint: { file: 'src/data.js', line: 2 },
          },
          {
            ref: 'count',
            originalText: originalCount,
            newText: nextCount,
            nearbyEditableTexts: [{ text: originalLabel }],
          },
        ],
      },
    ],
    candidates: [
      {
        entryId: 'entry-a',
        ref: 'label',
        originalText: originalLabel,
        textMatches: [{ file: 'src/data.js', line: 2, kind: 'text' }],
        objectKeyMatches: [
          { file: 'src/data.js', line: 5, needle: originalLabel },
          { file: 'src/visuals.js', line: 2, needle: originalLabel },
        ],
        contextTextMatches: [{ file: 'src/data.js', line: 2, kind: 'context' }],
      },
      {
        entryId: 'entry-a',
        ref: 'count',
        originalText: originalCount,
        textMatches: [{ file: 'src/data.js', line: 5, kind: 'text' }],
        objectKeyMatches: [{ file: 'src/data.js', line: 5, needle: originalLabel }],
        contextTextMatches: [{ file: 'src/data.js', line: 5, kind: 'context' }],
      },
    ],
  };
}

describe('live-e2e LLM agent parseManualEditResponse', () => {
  const validParsed = {
    status: 'done',
    coverage: [
      {
        entryId: 'cafebabe',
        coveredOps: ['New'],
        sourceTargets: ['src/App.jsx:3'],
        coupledKeyEdits: ['none'],
        typedValueDecision: 'not applicable',
      },
    ],
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
      coverage: [],
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
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /Preserve numeric, boolean, array, and object model data/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /quoted display text/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /sourceContext is the current source/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /op\.sourceHint\.file \+ op\.sourceHint\.line/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /Missing sourceHint is not a failure/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /objectKeyMatches/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /data object or mapped list item/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /sourceContext\[\]\.text/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /quote style/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /enclosing source line/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /hinted leaf text/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /Do not rewrite parent sections/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /Never use DOM outerHTML as sourceEdit\.originalText/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /mixed markup that renders one visible phrase/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /coupled lookup keys/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /string literal or object key/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /animations, icons, images, assets/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /same lookup\/map entry/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /Return a complete result/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /event\.repair/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /repair the current source/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /do not restart from old source or roll files back/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /ambiguous or broad/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /Preserve op\.newText exactly/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /leading zeros/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /non-numeric visible text/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /quoted source string/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /back to a plain number/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /framework-sensitive characters/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /valid source/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /JSX\/TSX text nodes/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /expression-only text node/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /quoted expression such as \{"7 seats"\}/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /coverage is harness-only planning data/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /coveredOps/);
  });

  it('keeps manual edit prompt guidance generic instead of fixture-specific', () => {
    for (const fixtureToken of ['Typography', 'Responsive', 'TypoXXX', 'RespoXXX', 'TT33']) {
      assert.doesNotMatch(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, new RegExp(fixtureToken));
    }
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
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /Do not ask what to do/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /discard edits/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /unusual copy/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /redirect to the visual picker/);
    assert.doesNotMatch(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /What would you like to do with these changes/i);
  });

  it('tells the model chunked manual Apply events are complete current work units', () => {
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /current event\.batch/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /later staged edits arrive in later chunks/);
  });

  it('tells the model compact manual Apply events load full evidence out-of-band', () => {
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /evidencePath is present/);
    assert.match(MANUAL_EDIT_SYSTEM_INSTRUCTIONS, /full source evidence was loaded/);
  });
});

describe('live-e2e LLM agent manual edit planning coverage validation', () => {
  it('requires harness-only coverage rows for applied entries in provider responses', () => {
    const error = validateManualEditPlanningCoverage(
      {
        status: 'done',
        appliedEntryIds: ['entry-a'],
        coverage: [],
        sourceEdits: [
          {
            entryId: 'entry-a',
            file: 'src/data.js',
            originalText: 'Old',
            newText: 'New',
          },
        ],
      },
      {
        entries: [
          {
            id: 'entry-a',
            ops: [{ newText: 'New' }],
          },
        ],
      },
    );

    assert.match(error, /no coverage rows/);
  });

  it('requires coverage rows to list every staged op for applied entries', () => {
    const error = validateManualEditPlanningCoverage(
      {
        status: 'done',
        appliedEntryIds: ['entry-a'],
        coverage: [
          {
            entryId: 'entry-a',
            coveredOps: ['New label'],
          },
        ],
      },
      {
        entries: [
          {
            id: 'entry-a',
            ops: [{ newText: 'New label' }, { newText: '007' }],
          },
        ],
      },
    );

    assert.match(error, /does not list staged copy "007"/);
  });

  it('accepts coverage that lists every staged op for applied entries', () => {
    const error = validateManualEditPlanningCoverage(
      {
        status: 'done',
        appliedEntryIds: ['entry-a'],
        coverage: [
          {
            entryId: 'entry-a',
            coveredOps: ['New label', '007'],
            sourceTargets: ['src/data.js:2'],
            coupledKeyEdits: ['src/visuals.js:4'],
            typedValueDecision: 'quoted display text',
          },
        ],
      },
      {
        entries: [
          {
            id: 'entry-a',
            ops: [{ newText: 'New label' }, { newText: '007' }],
          },
        ],
      },
    );

    assert.equal(error, null);
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

  it('gives rendered-value guidance for failed counts without sourceHint', () => {
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
    assert.match(error, /location that renders/);
    assert.match(error, /preserving typed model data/);
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

  it('rejects raw JSX text replacements with framework-sensitive characters', () => {
    const error = validateManualEditCoverage(
      {
        status: 'done',
        appliedEntryIds: ['entry-a'],
        sourceEdits: [
          {
            entryId: 'entry-a',
            file: 'src/App.jsx',
            originalText: '<article className="feature-card">One</article>',
            newText: '<article className="feature-card">One: alpha -> beta</article>',
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
              { originalText: 'One', newText: 'One: alpha -> beta' },
              { originalText: '7', newText: '7 workshop seats remain' },
            ],
          },
        ],
      },
    );

    assert.match(error, /raw JSX text/);
    assert.match(error, /valid JSX/);
  });

  it('accepts quoted JSX expression replacements with framework-sensitive characters', () => {
    const error = validateManualEditCoverage(
      {
        status: 'done',
        appliedEntryIds: ['entry-a'],
        sourceEdits: [
          {
            entryId: 'entry-a',
            file: 'src/App.jsx',
            originalText: '<article className="feature-card">One</article>',
            newText: '<article className="feature-card">{"One: alpha -> beta"}</article>',
          },
        ],
      },
      {
        entries: [
          {
            id: 'entry-a',
            ops: [{ originalText: 'One', newText: 'One: alpha -> beta' }],
          },
        ],
      },
    );

    assert.equal(error, null);
  });

  it('accepts static markup replacements for integer display edits when model data stays typed', () => {
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
            originalText: '<span className="capacity-count">{String(workshopStats.seats)}</span>',
            newText: '<span className="capacity-count">7 workshop seats remain</span>',
          },
        ],
      },
      batch,
    );

    assert.equal(error, null);
  });

  it('rejects integer display edits that corrupt typed model data', () => {
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
            line: 1,
            originalText: 'const workshopStats = { seats: 7 };',
            newText: "const workshopStats = { seats: '7 workshop seats remain' };",
          },
        ],
      },
      batch,
    );

    assert.match(error, /model data/);
    assert.match(error, /preserve typed model data/);
  });

  it('gives exact-copy guidance when leading-zero display copy is normalized away', () => {
    const error = validateManualEditCoverage(
      {
        status: 'done',
        appliedEntryIds: ['entry-a'],
        sourceEdits: [
          {
            entryId: 'entry-a',
            file: 'src/data.js',
            originalText: "'Old label': 33",
            newText: "'New label': 33",
          },
        ],
      },
      {
        entries: [
          {
            id: 'entry-a',
            ops: [
              { originalText: 'Old label', newText: 'New label' },
              { originalText: '33', newText: '0033', container: { textContent: 'Old label 33' } },
            ],
          },
        ],
      },
    );

    assert.match(error, /leading zeros/);
    assert.match(error, /must not be normalized/);
    assert.match(error, /quoted display value/);
    assert.match(error, /lookup\/map only when evidence shows/);
  });

  it('gives quoted-source guidance when non-numeric display copy is normalized away', () => {
    const error = validateManualEditCoverage(
      {
        status: 'done',
        appliedEntryIds: ['entry-a'],
        sourceEdits: [
          {
            entryId: 'entry-a',
            file: 'src/data.js',
            originalText: "'Old label': 23",
            newText: "'New label': 33",
          },
        ],
      },
      {
        entries: [
          {
            id: 'entry-a',
            ops: [
              { originalText: 'Old label', newText: 'New label' },
              { originalText: '23', newText: 'Label count', container: { textContent: 'Old label 23' } },
            ],
          },
        ],
      },
    );

    assert.match(error, /staged copy "Label count" exactly/);
    assert.match(error, /quoted source value/);
    assert.match(error, /bare identifier/);
    assert.match(error, /lookup\/map only when evidence shows/);
  });

  it('rejects display text pasted raw into a data lookup replacement', () => {
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
            newText: "'New label': display17",
          },
        ],
      },
      {
        entries: [
          {
            id: 'entry-a',
            ops: [
              { originalText: 'Old label', newText: 'New label' },
              { originalText: '17', newText: 'display17' },
            ],
          },
        ],
      },
    );

    assert.match(error, /display text/);
    assert.match(error, /quoted source text/);
    assert.match(error, /raw user text/);
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

  it('rejects label renames that miss dependent source keys', () => {
    const error = validateManualEditCoverage(
      {
        status: 'done',
        appliedEntryIds: ['entry-a'],
        sourceEdits: [
          {
            entryId: 'entry-a',
            file: 'src/data.js',
            line: 10,
            originalText: "label: 'Old label'",
            newText: "label: 'New label'",
          },
          {
            entryId: 'entry-a',
            file: 'src/data.js',
            line: 20,
            originalText: "'Old label': 17",
            newText: "'New label': 'many seats'",
          },
        ],
      },
      {
        entries: [
          {
            id: 'entry-a',
            ops: [
              { ref: 'label', originalText: 'Old label', newText: 'New label' },
              { ref: 'count', originalText: '17', newText: 'many seats' },
            ],
          },
        ],
        candidates: [
          {
            entryId: 'entry-a',
            ref: 'label',
            objectKeyMatches: [
              { file: 'src/data.js', line: 20, needle: 'Old label' },
              { file: 'src/visuals.js', line: 5, needle: 'Old label' },
            ],
          },
        ],
      },
    );

    assert.match(error, /objectKeyMatches/);
    assert.match(error, /include a sourceEdit/);
    assert.match(error, /dependent lookup\/asset\/count\/icon\/image key/);
    assert.match(error, /src\/visuals\.js:5/);
  });

  it('combines label/count and dependent-key retry guidance for the same entry', () => {
    const error = validateManualEditCoverage(
      {
        status: 'done',
        appliedEntryIds: ['entry-a'],
        sourceEdits: [
          {
            entryId: 'entry-a',
            file: 'src/data.js',
            line: 10,
            originalText: "label: 'Old label'",
            newText: "label: 'New label'",
          },
          {
            entryId: 'entry-a',
            file: 'src/data.js',
            line: 20,
            originalText: "'Old label': 33",
            newText: "'New label': 33",
          },
        ],
      },
      {
        entries: [
          {
            id: 'entry-a',
            ops: [
              { ref: 'label', originalText: 'Old label', newText: 'New label' },
              { ref: 'count', originalText: '33', newText: '0033', container: { textContent: 'Old label 33' } },
            ],
          },
        ],
        candidates: [
          {
            entryId: 'entry-a',
            ref: 'label',
            objectKeyMatches: [
              { file: 'src/visuals.js', line: 5, needle: 'Old label' },
            ],
          },
        ],
      },
    );

    assert.match(error, /exact staged copy "0033"/);
    assert.match(error, /quoted display value/);
    assert.match(error, /src\/visuals\.js:5/);
  });

  it('allows label renames that update dependent source keys', () => {
    const error = validateManualEditCoverage(
      {
        status: 'done',
        appliedEntryIds: ['entry-a'],
        sourceEdits: [
          {
            entryId: 'entry-a',
            file: 'src/data.js',
            line: 10,
            originalText: "label: 'Old label'",
            newText: "label: 'New label'",
          },
          {
            entryId: 'entry-a',
            file: 'src/data.js',
            line: 20,
            originalText: "'Old label': 17",
            newText: "'New label': 'many seats'",
          },
          {
            entryId: 'entry-a',
            file: 'src/visuals.js',
            line: 5,
            originalText: "'Old label': '<svg>'",
            newText: "'New label': '<svg>'",
          },
        ],
      },
      {
        entries: [
          {
            id: 'entry-a',
            ops: [
              { ref: 'label', originalText: 'Old label', newText: 'New label' },
              { ref: 'count', originalText: '17', newText: 'many seats' },
            ],
          },
        ],
        candidates: [
          {
            entryId: 'entry-a',
            ref: 'label',
            objectKeyMatches: [
              { file: 'src/data.js', line: 20, needle: 'Old label' },
              { file: 'src/visuals.js', line: 5, needle: 'Old label' },
            ],
          },
        ],
      },
    );

    assert.equal(error, null);
  });

  it('allows surgical same-line key literal replacements for dependent source keys', () => {
    const error = validateManualEditCoverage(
      {
        status: 'done',
        appliedEntryIds: ['entry-a'],
        sourceEdits: [
          {
            entryId: 'entry-a',
            file: 'src/data.js',
            line: 10,
            originalText: "label: 'Old label'",
            newText: "label: 'New label'",
          },
          {
            entryId: 'entry-a',
            file: 'src/visuals.js',
            line: 5,
            originalText: "'Old label'",
            newText: "'New label'",
          },
        ],
      },
      {
        entries: [
          {
            id: 'entry-a',
            ops: [
              { ref: 'label', originalText: 'Old label', newText: 'New label' },
            ],
          },
        ],
        candidates: [
          {
            entryId: 'entry-a',
            ref: 'label',
            objectKeyMatches: [
              { file: 'src/visuals.js', line: 5, needle: 'Old label' },
            ],
          },
        ],
      },
    );

    assert.equal(error, null);
  });

  it('does not apply sourceHint line checks to dependent key edits for the same label text', () => {
    const error = validateManualEditCoverage(
      {
        status: 'done',
        appliedEntryIds: ['entry-a'],
        sourceEdits: [
          {
            entryId: 'entry-a',
            file: 'src/data.js',
            line: 2,
            originalText: "label: 'Old label'",
            newText: "label: 'New label'",
          },
          {
            entryId: 'entry-a',
            file: 'src/data.js',
            line: 5,
            originalText: "'Old label': 7",
            newText: "'New label': '007'",
          },
        ],
      },
      {
        entries: [
          {
            id: 'entry-a',
            ops: [
              {
                ref: 'label',
                originalText: 'Old label',
                newText: 'New label',
                sourceHint: { file: 'src/data.js', line: 2 },
              },
              { ref: 'count', originalText: '7', newText: '007' },
            ],
          },
        ],
        candidates: [
          {
            entryId: 'entry-a',
            ref: 'label',
            objectKeyMatches: [
              { file: 'src/data.js', line: 5, needle: 'Old label' },
            ],
          },
        ],
      },
    );

    assert.equal(error, null);
  });

  it('allows label restores that restore dependent source keys and typed counts', () => {
    const error = validateManualEditCoverage(
      {
        status: 'done',
        appliedEntryIds: ['entry-a'],
        sourceEdits: [
          {
            entryId: 'entry-a',
            file: 'src/data.js',
            line: 10,
            originalText: "label: 'New label'",
            newText: "label: 'Old label'",
          },
          {
            entryId: 'entry-a',
            file: 'src/data.js',
            line: 20,
            originalText: "'New label': '0033'",
            newText: "'Old label': 33",
          },
          {
            entryId: 'entry-a',
            file: 'src/visuals.js',
            line: 5,
            originalText: "'New label': '<svg>'",
            newText: "'Old label': '<svg>'",
          },
        ],
      },
      {
        entries: [
          {
            id: 'entry-a',
            ops: [
              { ref: 'label', originalText: 'New label', newText: 'Old label' },
              { ref: 'count', originalText: '0033', newText: '33' },
            ],
          },
        ],
        candidates: [
          {
            entryId: 'entry-a',
            ref: 'label',
            objectKeyMatches: [
              { file: 'src/data.js', line: 20, needle: 'New label' },
              { file: 'src/visuals.js', line: 5, needle: 'New label' },
            ],
          },
        ],
      },
    );

    assert.equal(error, null);
  });

  it('rejects paired label/count restores that leave plain integer counts quoted', () => {
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

  it('rejects paired label/count restores that replace only the inner quoted string text', () => {
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
  it('makes progressive phase boundaries and lazy parameters explicit', () => {
    const first = progressiveVariantGuidance({ count: 1, progressive: { phase: 'first' } });
    const remaining = progressiveVariantGuidance({
      count: 3,
      progressive: { phase: 'remaining', omitFirstVariantCss: true },
    });
    assert.match(first, /params: \[\]/);
    assert.match(first, /materially different/);
    assert.match(remaining, /complete final set of exactly 3 variants/);
    assert.match(remaining, /Keep its innerHtml exactly unchanged/);
    assert.match(remaining, /Do not repeat or modify any scopedCss rule/);
  });

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
  it('enforces the exact requested variant count', () => {
    const parsed = { scopedCss: '', variants: [{ innerHtml: '<h1>One</h1>', params: [] }] };
    assert.match(validateVariantCount(parsed, { count: 2 }), /expected exactly 2 variants, received 1/);
    assert.equal(validateVariantCount(parsed, { count: 1 }), null);
  });

  it('defers progressive params and preserves the visible first variant', () => {
    const firstHtml = '<h1 class="hero-title"><span>One</span></h1>';
    assert.match(
      validateProgressiveVariantOutput(
        { variants: [{ innerHtml: firstHtml, params: [{ id: 'weight' }] }] },
        { progressive: { phase: 'first' } },
      ),
      /defer params/,
    );
    assert.equal(
      validateProgressiveVariantOutput(
        { variants: [{ innerHtml: firstHtml, params: [] }] },
        { progressive: { phase: 'remaining', firstVariant: { innerHtml: firstHtml } } },
      ),
      null,
    );
    assert.match(
      validateProgressiveVariantOutput(
        { variants: [{ innerHtml: '<h1>Changed</h1>', params: [] }] },
        { progressive: { phase: 'remaining', firstVariant: { innerHtml: firstHtml } } },
      ),
      /preserve variant 1/,
    );
    assert.match(
      validateProgressiveVariantOutput(
        {
          scopedCss: '@scope ([data-impeccable-variant="1"]) { .hero-title { color: red; } }',
          variants: [{ innerHtml: firstHtml, params: [] }],
        },
        {
          progressive: {
            phase: 'remaining',
            firstVariant: { innerHtml: firstHtml },
            omitFirstVariantCss: true,
          },
        },
      ),
      /omit already-published variant 1 CSS/,
    );
  });

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
