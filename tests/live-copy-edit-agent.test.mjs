import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCopyEditBatchPrompt,
  buildCopyEditAgentPrompt,
  chooseCopyEditAgent,
  parseCopyEditBatchResult,
  parseCopyEditAgentResult,
  runCopyEditPostApplyChecks,
} from '../skill/scripts/live-copy-edit-agent.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('live-copy-edit-agent', () => {
  it('builds a focused prompt for source copy edits', () => {
    const prompt = buildCopyEditAgentPrompt({
      id: 'abc12345',
      pageUrl: '/',
      element: {
        tagName: 'div',
        classes: ['hero'],
        textContent: 'Hero text',
        outerHTML: '<div class="hero"><h1>After</h1></div>',
      },
      ops: [{
        ref: 'body>div.hero:nth-of-type(1)>h1:nth-of-type(1)',
        contextRef: 'body>div.hero:nth-of-type(1)',
        tag: 'h1',
        classes: ['title'],
        originalText: 'Before',
        newText: 'After',
        sourceHint: { file: '/tmp/project/src/page.astro', line: 12, column: 8 },
      }],
    }, { cwd: '/tmp/project' });

    assert.match(prompt, /Impeccable live copy-edit applier/);
    assert.match(prompt, /Make the smallest source change/);
    assert.match(prompt, /"originalText": "Before"/);
    assert.match(prompt, /"newText": "After"/);
    assert.match(prompt, /"line": 12/);
    assert.match(prompt, /Return ONLY JSON/);
  });

  it('parses direct and wrapped agent completion JSON', () => {
    assert.deepEqual(
      parseCopyEditAgentResult('{"status":"done","files":["src/page.astro"]}'),
      { status: 'done', files: ['src/page.astro'] },
    );
    assert.deepEqual(
      parseCopyEditAgentResult(JSON.stringify({ result: '{"status":"error","message":"ambiguous"}' })),
      { status: 'error', message: 'ambiguous' },
    );
    assert.equal(parseCopyEditAgentResult('not json'), null);
  });

  it('builds a batch prompt with duplicate-card context and candidate evidence', () => {
    const prompt = buildCopyEditBatchPrompt({
      pageUrl: '/',
      entries: [{
        id: 'cards',
        pageUrl: '/',
        element: { tagName: 'div', classes: ['foundation-card'], textContent: 'Color & Contrast 29 Accessibility' },
        ops: [{
          ref: 'body>main>section#foundation>div.foundation-grid>div:nth-of-type(2)>span.foundation-card-label:nth-of-type(1)',
          contextRef: 'body>main>section#foundation>div.foundation-grid>div:nth-of-type(2)',
          tag: 'span',
          classes: ['foundation-card-label'],
          originalText: 'Color & Contrast',
          newText: 'Color!!!',
          nearbyEditableTexts: [{ text: '29' }, { text: 'Accessibility' }],
        }],
      }],
      candidates: [{
        entryId: 'cards',
        ref: 'body>main>section#foundation>div.foundation-grid>div:nth-of-type(2)>span.foundation-card-label:nth-of-type(1)',
        textMatches: [{ file: 'site/scripts/data.js', line: 25 }],
        objectKeyMatches: [{ file: 'site/scripts/components/foundation-animations.js', line: 3 }],
      }],
    }, { cwd: '/tmp/project' });

    assert.match(prompt, /staged copy-edit batch applier/);
    assert.match(prompt, /Apply all staged edits in one coherent batch/);
    assert.match(prompt, /"entryId": "cards"/);
    assert.match(prompt, /foundation-card-label/);
    assert.match(prompt, /site\/scripts\/data\.js/);
    assert.match(prompt, /Return ONLY JSON/);
  });

  it('parses partial batch results', () => {
    assert.deepEqual(
      parseCopyEditBatchResult('{"status":"partial","appliedEntryIds":["a"],"failed":[{"entryId":"b","reason":"ambiguous"}],"files":["src/page.js"]}'),
      {
        status: 'partial',
        message: null,
        appliedEntryIds: ['a'],
        failed: [{ entryId: 'b', reason: 'ambiguous', candidates: [] }],
        files: ['src/page.js'],
        notes: [],
      },
    );
  });

  it('flags invalid JS and leftover carbonize markers in post-apply checks', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-agent-checks-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'src', 'bad.js'), 'const value = ;\n// impeccable-carbonize-end\n');
      const checks = runCopyEditPostApplyChecks({ cwd: tmp, files: ['src/bad.js'] });
      assert.equal(checks.ok, false);
      assert.equal(checks.failures.some((item) => item.reason === 'leftover_impeccable_marker'), true);
      assert.equal(checks.failures.some((item) => item.reason === 'invalid_js'), true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('respects off mode before trying local AI commands', () => {
    assert.equal(chooseCopyEditAgent({ env: { IMPECCABLE_LIVE_COPY_AGENT: 'off' } }), null);
    assert.equal(chooseCopyEditAgent({ env: { IMPECCABLE_LIVE_COPY_AGENT: 'false' } }), null);
    assert.equal(chooseCopyEditAgent({ env: { IMPECCABLE_LIVE_COPY_AGENT: 'mock' } }), 'mock');
  });
});
