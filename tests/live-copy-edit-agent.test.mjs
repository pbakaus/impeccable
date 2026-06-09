import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCopyEditBatchPrompt,
  chooseCopyEditAgent,
  describeNoProviderError,
  extractRunnerErrorMessage,
  parseCopyEditBatchResult,
  runCopyEditBatchAgent,
  runCopyEditPostApplyChecks,
} from '../skill/scripts/live-copy-edit-agent.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('live-copy-edit-agent', () => {
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
    assert.match(prompt, /The user already clicked Apply\. Do not ask what to do with the staged edits/);
    assert.match(prompt, /Apply all staged edits in one coherent batch/);
    assert.match(prompt, /"entryId": "cards"/);
    assert.match(prompt, /foundation-card-label/);
    assert.match(prompt, /site\/scripts\/data\.js/);
    assert.match(prompt, /Preserve numeric, boolean, array, and object model data/);
    assert.match(prompt, /do not replace the underlying typed model declaration/);
    assert.match(prompt, /impeccable:manual-edit-validate/);
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
        warnings: [],
      },
    );
  });

  it('preserves structured warnings in batch results', () => {
    assert.deepEqual(
      parseCopyEditBatchResult('{"status":"done","appliedEntryIds":["a"],"files":["src/page.js"],"warnings":[{"reason":"repair_followup","file":"src/page.js"},"plain warning"]}'),
      {
        status: 'done',
        message: null,
        appliedEntryIds: ['a'],
        failed: [],
        files: ['src/page.js'],
        notes: [],
        warnings: [
          { reason: 'repair_followup', file: 'src/page.js' },
          { message: 'plain warning' },
        ],
      },
    );
  });

  it('flags invalid JS and actual leftover carbonize markers in post-apply checks', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-agent-checks-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'src', 'bad.js'), 'const value = ;\n');
      fs.writeFileSync(path.join(tmp, 'src', 'page.html'), '<!-- impeccable-carbonize-end abcdef12 -->\n<h1>Hi</h1>\n');
      const checks = runCopyEditPostApplyChecks({ cwd: tmp, files: ['src/bad.js', 'src/page.html'] });
      assert.equal(checks.ok, false);
      assert.equal(checks.failures.some((item) => item.reason === 'leftover_impeccable_marker'), true);
      assert.equal(checks.failures.some((item) => item.reason === 'invalid_js'), true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('flags invalid JSX syntax in post-apply checks', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-agent-jsx-checks-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'src', 'App.jsx'), 'export default function App() { return <h1>Broken</h2>; }\n');
      const checks = runCopyEditPostApplyChecks({ cwd: tmp, files: ['src/App.jsx'] });
      assert.equal(checks.ok, false);
      assert.equal(checks.failures.some((item) => item.reason === 'invalid_source_syntax'), true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('flags invalid JSON in post-apply checks', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-agent-json-checks-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'src', 'data.json'), '{"title":"New",}\n');
      const checks = runCopyEditPostApplyChecks({ cwd: tmp, files: ['src/data.json'] });
      assert.equal(checks.ok, false);
      assert.equal(checks.failures.some((item) => item.reason === 'invalid_json'), true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('does not flag live-mode marker words when they only appear as source literals', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-agent-literals-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, 'src', 'live-helper.js'),
        [
          'const words = "impeccable-carbonize- data-impeccable-variant IMPECCABLE_VARIANT impeccable-live-variant";',
          'const selector = "[data-impeccable-variant=\\"1\\"]";',
          'const example = "<div data-impeccable-variant=\\"1\\">demo</div>";',
          'export { words, selector, example };',
          '',
        ].join('\n'),
      );
      const checks = runCopyEditPostApplyChecks({ cwd: tmp, files: ['src/live-helper.js'] });
      assert.equal(checks.ok, true);
      assert.deepEqual(checks.failures, []);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('respects off mode before trying local AI commands', () => {
    assert.equal(chooseCopyEditAgent({ env: { IMPECCABLE_LIVE_COPY_AGENT: 'off' } }), null);
    assert.equal(chooseCopyEditAgent({ env: { IMPECCABLE_LIVE_COPY_AGENT: 'false' } }), null);
    assert.equal(chooseCopyEditAgent({ env: { IMPECCABLE_LIVE_COPY_AGENT: 'mock' } }), 'mock');
  });

  it('surfaces Claude CLI auth errors from is_error JSON output', () => {
    const output = '{"type":"result","subtype":"success","is_error":true,"duration_ms":36,'
      + '"result":"Not logged in · Please run /login","stop_reason":"stop_sequence","session_id":"abc"}';
    const hint = extractRunnerErrorMessage(output, 'claude');
    assert.ok(hint, 'expected extractRunnerErrorMessage to return a hint');
    assert.match(hint, /claude CLI:/);
    assert.match(hint, /Not logged in/);
  });

  it('falls back to last non-empty line when no JSON is recognizable', () => {
    const hint = extractRunnerErrorMessage('warm-up...\nsome noise\nfatal: provider unreachable\n', 'codex');
    assert.equal(hint, 'codex: fatal: provider unreachable');
  });

  it('returns null when there is nothing useful to surface', () => {
    assert.equal(extractRunnerErrorMessage('', 'claude'), null);
    assert.equal(extractRunnerErrorMessage('   \n   \n', 'claude'), null);
  });

  it('describeNoProviderError pinpoints which CLI needs which action', () => {
    const claudeInstalledUnauthed = describeNoProviderError({
      exists: (cmd) => cmd === 'claude',
      authed: () => false,
      env: {},
    });
    assert.match(claudeInstalledUnauthed, /Claude CLI: installed but not selected/);
    assert.match(claudeInstalledUnauthed, /subprocess may be unable to read/);
    assert.match(claudeInstalledUnauthed, /claude setup-token/);
    assert.match(claudeInstalledUnauthed, /CLAUDE_CODE_OAUTH_TOKEN/);
    assert.match(claudeInstalledUnauthed, /ANTHROPIC_API_KEY/);
    assert.match(claudeInstalledUnauthed, /Codex CLI: not installed/);

    const tokenSetButInvalid = describeNoProviderError({
      exists: (cmd) => cmd === 'claude',
      authed: () => false,
      env: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-broken' },
    });
    assert.match(tokenSetButInvalid, /CLAUDE_CODE_OAUTH_TOKEN is set but the CLI still rejected it/);

    const nothingInstalled = describeNoProviderError({ exists: () => false, authed: () => false, env: {} });
    assert.match(nothingInstalled, /Claude CLI: not installed/);
    assert.match(nothingInstalled, /Codex CLI: not installed/);
    assert.match(nothingInstalled, /IMPECCABLE_LIVE_COPY_AGENT=mock/);

    const codexInstalled = describeNoProviderError({
      exists: (cmd) => cmd === 'codex',
      authed: () => false,
      env: {},
    });
    assert.match(codexInstalled, /Codex CLI: installed/);
    assert.match(codexInstalled, /codex login/);
  });

  it('auto mode picks the first authenticated provider via injected authCheck', () => {
    const claudeUnauthedCodexAuthed = (cmd) => cmd === 'codex';
    assert.equal(
      chooseCopyEditAgent({ env: { IMPECCABLE_LIVE_COPY_AGENT: 'auto' }, authCheck: claudeUnauthedCodexAuthed }),
      'codex',
    );

    const onlyClaudeAuthed = (cmd) => cmd === 'claude';
    assert.equal(
      chooseCopyEditAgent({ env: { IMPECCABLE_LIVE_COPY_AGENT: 'auto' }, authCheck: onlyClaudeAuthed }),
      'claude',
    );

    const noneAuthed = () => false;
    assert.equal(
      chooseCopyEditAgent({ env: {}, authCheck: noneAuthed }),
      null,
    );
  });

  it('auto mode falls back to chat when no CLI is authenticated and chat is available', () => {
    const noneAuthed = () => false;
    assert.equal(
      chooseCopyEditAgent({
        env: { IMPECCABLE_LIVE_COPY_AGENT: 'auto' },
        authCheck: noneAuthed,
        chatAvailable: () => true,
      }),
      'chat',
    );
    assert.equal(
      chooseCopyEditAgent({
        env: { IMPECCABLE_LIVE_COPY_AGENT: 'auto' },
        authCheck: noneAuthed,
        chatAvailable: () => false,
      }),
      null,
    );
    // Explicit chat mode honors chatAvailable.
    assert.equal(
      chooseCopyEditAgent({
        env: { IMPECCABLE_LIVE_COPY_AGENT: 'chat' },
        chatAvailable: () => true,
      }),
      'chat',
    );
    assert.equal(
      chooseCopyEditAgent({
        env: { IMPECCABLE_LIVE_COPY_AGENT: 'chat' },
        chatAvailable: () => false,
      }),
      null,
    );
    // CLI providers still preferred when authenticated.
    assert.equal(
      chooseCopyEditAgent({
        env: { IMPECCABLE_LIVE_COPY_AGENT: 'auto' },
        authCheck: (cmd) => cmd === 'codex',
        chatAvailable: () => true,
      }),
      'codex',
    );
  });

  it('runCopyEditBatchAgent with provider=chat delegates to applyBatchToSource', async () => {
    const batch = {
      pageUrl: '/',
      entries: [{ id: 'a1b2c3d4', pageUrl: '/', element: {}, ops: [] }],
      candidates: [],
    };
    let receivedBatch = null;
    const fakeApply = async (b) => {
      receivedBatch = b;
      return {
        status: 'done',
        appliedEntryIds: ['a1b2c3d4'],
        failed: [],
        files: ['site/pages/index.astro'],
        notes: ['ok'],
      };
    };
    const result = await runCopyEditBatchAgent(batch, {
      provider: 'chat',
      applyBatchToSource: fakeApply,
    });
    assert.equal(receivedBatch, batch);
    assert.equal(result.status, 'done');
    assert.deepEqual(result.appliedEntryIds, ['a1b2c3d4']);
    assert.deepEqual(result.files, ['site/pages/index.astro']);
    assert.deepEqual(result.notes, ['ok']);
  });

  it('runCopyEditBatchAgent with provider=chat rejects when no callback is supplied', async () => {
    await assert.rejects(
      runCopyEditBatchAgent({ entries: [], candidates: [] }, { provider: 'chat' }),
      /chat provider requires applyBatchToSource/,
    );
  });

  it('describeNoProviderError mentions starting impeccable live when chat is the missing piece', () => {
    const noChatPolling = describeNoProviderError({
      exists: () => false,
      authed: () => false,
      chatAvailable: () => false,
      env: {},
    });
    assert.match(noChatPolling, /Chat: no Impeccable live session is currently polling/);
    assert.match(noChatPolling, /Start Impeccable live/);
  });
});
