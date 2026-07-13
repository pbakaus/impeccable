import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { CODEX_WORKER_OWNER } from '../skill/scripts/live/codex-worker.mjs';
import {
  CODEX_WORKER_EVENT_TYPES,
  CodexLiveWorkerSupervisor,
  buildDeterministicScaffoldCommand,
} from '../skill/scripts/live/codex-worker-supervisor.mjs';
import { createLiveSessionStore } from '../skill/scripts/live/session-store.mjs';
import { selectAvailablePendingEvent } from '../skill/scripts/live/poll-lanes.mjs';

describe('Codex Live worker supervisor ownership and lifecycle', () => {
  it('partitions worker and foreground control events without overlapping leases', () => {
    const entries = [
      { event: { type: 'steer' }, leaseUntil: 0, seq: 1 },
      { event: { type: 'generate' }, leaseUntil: 0, seq: 2 },
      { event: { type: 'manual_edit_apply' }, leaseUntil: 0, seq: 3 },
      { event: { type: 'accept' }, leaseUntil: 0, seq: 4 },
      { event: { type: 'carbonize_cleanup' }, leaseUntil: 0, seq: 5 },
      { event: { type: 'exit' }, leaseUntil: 0, seq: 6 },
    ];
    assert.equal(selectAvailablePendingEvent(entries, { types: CODEX_WORKER_EVENT_TYPES }).event.type, 'accept');
    assert.equal(selectAvailablePendingEvent(entries, {
      types: ['steer', 'manual_edit_apply', 'carbonize_cleanup', 'exit'],
    }).event.type, 'exit');
    assert.equal(CODEX_WORKER_EVENT_TYPES.includes('steer'), false);
    assert.equal(CODEX_WORKER_EVENT_TYPES.includes('manual_edit_apply'), false);
    assert.equal(CODEX_WORKER_EVENT_TYPES.includes('carbonize_cleanup'), false);
    assert.equal(CODEX_WORKER_EVENT_TYPES.includes('exit'), false);
  });

  it('builds the same deterministic wrap/insert target contract as foreground Live', () => {
    const replace = buildDeterministicScaffoldCommand({
      id: 'abc12345',
      count: 3,
      element: { id: 'hero', classes: ['hero', 'title'], tagName: 'H1', textContent: '  Exact hero copy  ' },
    }, '/scripts');
    assert.equal(replace.script, '/scripts/live-wrap.mjs');
    assert.deepEqual(replace.args, [
      '--id', 'abc12345', '--count', '3', '--element-id', 'hero',
      '--classes', 'hero,title', '--tag', 'h1', '--text', 'Exact hero copy',
    ]);
    const insert = buildDeterministicScaffoldCommand({
      id: 'abc12346',
      count: 2,
      mode: 'insert',
      insert: { position: 'before', anchor: { tag: 'section', text: 'Anchor' } },
    }, '/scripts');
    assert.equal(insert.script, '/scripts/live-insert.mjs');
    assert.deepEqual(insert.args, [
      '--id', 'abc12346', '--count', '2', '--position', 'before',
      '--tag', 'section', '--query', 'Anchor', '--text', 'Anchor',
    ]);
  });

  it('never resumes a desktop or otherwise unowned thread record', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'codex-supervisor-owner-'));
    const statePath = path.join(cwd, '.impeccable/live/codex-worker.json');
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify({ owner: 'desktop', cwd, threadId: 'desktop-thread' }));
    const client = fakeClient();
    const supervisor = createSupervisor({ cwd, statePath, client });
    await supervisor.initialize();
    assert.equal(client.calls.resumeDedicatedThread.length, 0);
    assert.equal(client.calls.startDedicatedThread.length, 1);
    assert.equal(client.calls.startDedicatedThread[0].ephemeral, false);
    assert.equal(client.calls.startDedicatedThread[0].sandbox, 'read-only');
    await supervisor.shutdown();
  });

  it('resumes only a durable Live-owned worker thread', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'codex-supervisor-resume-'));
    const statePath = path.join(cwd, '.impeccable/live/codex-worker.json');
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify({
      owner: CODEX_WORKER_OWNER,
      cwd,
      threadId: 'live-worker-thread',
      status: 'ready',
    }));
    const client = fakeClient();
    const supervisor = createSupervisor({ cwd, statePath, client });
    await supervisor.initialize();
    assert.equal(client.calls.resumeDedicatedThread.length, 1);
    assert.equal(client.calls.resumeDedicatedThread[0].threadId, 'live-worker-thread');
    assert.equal(client.calls.startDedicatedThread.length, 0);
    await supervisor.shutdown();
  });

  it('interrupts the active dedicated turn on early Accept or Discard', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'codex-supervisor-interrupt-'));
    const client = fakeClient();
    const supervisor = createSupervisor({
      cwd,
      statePath: path.join(cwd, 'state.json'),
      client,
    });
    supervisor.thread = { id: 'live-worker-thread' };
    supervisor.active = { eventId: 'generation-1', turnId: 'turn-1' };
    await supervisor.cancelActive('accept', 'generation-1');
    assert.deepEqual(client.calls.interruptTurn, [{ threadId: 'live-worker-thread', turnId: 'turn-1' }]);
    assert.equal(supervisor.canceled.has('generation-1'), true);
  });

  it('interrupts a canceled turn whose id arrives after Accept', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'codex-supervisor-late-turn-'));
    const client = fakeClient();
    const supervisor = createSupervisor({ cwd, statePath: path.join(cwd, 'state.json'), client });
    supervisor.thread = { id: 'live-worker-thread' };
    supervisor.model = client.models[0];
    supervisor.active = { eventId: 'generation-1', turnId: null };
    supervisor.canceled.add('generation-1');
    client.startTurn = async ({ onStarted }) => {
      onStarted('late-turn');
      await new Promise((resolve) => setImmediate(resolve));
      return { message: '{"files":[]}' };
    };
    await supervisor.runTurnWithReconnect({ input: 'work', outputSchema: {} });
    assert.deepEqual(client.calls.interruptTurn, [{ threadId: 'live-worker-thread', turnId: 'late-turn' }]);
  });

  it('queues carbonize cleanup onto the foreground control lane', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'codex-supervisor-carbonize-'));
    const cleanups = [];
    const client = fakeClient();
    const supervisor = new CodexLiveWorkerSupervisor({
      cwd,
      base: 'http://localhost:1',
      token: 'token',
      client,
      config: { model: null, effort: 'low', delivery: 'progressive', maxArtifactBytes: 2_000_000 },
      statePath: path.join(cwd, 'state.json'),
      scriptsDir: path.join(cwd, 'skill/scripts'),
      handleAccept: async (event) => ({
        ...event,
        _acceptResult: { handled: true, carbonize: true, file: 'src/App.jsx' },
      }),
      postCleanup: async (_base, _token, event) => { cleanups.push(event); },
    });
    supervisor.running = true;
    supervisor.thread = { id: 'live-worker-thread' };
    supervisor.fetchEvent = async (_base, _token, options) => {
      assert.deepEqual(options.types, CODEX_WORKER_EVENT_TYPES);
      return cleanups.length === 0
        ? { type: 'accept', id: 'abc12345', variantId: '1' }
        : { type: 'exit' };
    };
    await supervisor.run();
    assert.deepEqual(cleanups, [{
      sessionId: 'abc12345',
      file: 'src/App.jsx',
      variantId: '1',
      acceptResult: { handled: true, carbonize: true, file: 'src/App.jsx' },
    }]);
  });

  it('reconnects and resumes the owned worker once after app-server loss', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'codex-supervisor-reconnect-'));
    const client = fakeClient();
    let attempts = 0;
    client.startTurn = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('app-server exited');
      return { message: '{"files":[]}' };
    };
    const supervisor = createSupervisor({
      cwd,
      statePath: path.join(cwd, 'state.json'),
      client,
    });
    supervisor.thread = { id: 'live-worker-thread' };
    supervisor.model = client.models[0];
    supervisor.active = { eventId: 'generation-1', turnId: null };
    const result = await supervisor.runTurnWithReconnect({ input: 'work', outputSchema: {} });
    assert.equal(result.answer, '{"files":[]}');
    assert.equal(client.calls.reconnect, 1);
    assert.equal(client.calls.resumeDedicatedThread.length, 1);
  });

  it('archives its dedicated thread during clean Live shutdown', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'codex-supervisor-close-'));
    const client = fakeClient();
    const supervisor = createSupervisor({
      cwd,
      statePath: path.join(cwd, 'state.json'),
      client,
    });
    supervisor.thread = { id: 'live-worker-thread' };
    await supervisor.shutdown({ archive: true });
    assert.deepEqual(client.calls.archiveThread, [{ threadId: 'live-worker-thread' }]);
    assert.equal(client.calls.close, 1);
  });

  it('reports stopped rather than archived when thread archival fails', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'codex-supervisor-archive-fail-'));
    const client = fakeClient();
    client.archiveThread = async () => { throw new Error('archive unavailable'); };
    const statePath = path.join(cwd, 'state.json');
    const supervisor = createSupervisor({ cwd, statePath, client });
    supervisor.thread = { id: 'live-worker-thread' };
    await supervisor.shutdown({ archive: true });
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    assert.equal(state.status, 'stopped');
    assert.equal(state.archived, false);
  });

  it('treats an unused thread with no persisted rollout as already archived', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'codex-supervisor-empty-thread-'));
    const statePath = path.join(cwd, 'state.json');
    const client = fakeClient();
    client.archiveThread = async () => { throw new Error('thread/archive: no rollout found for thread id empty'); };
    const supervisor = createSupervisor({ cwd, statePath, client });
    supervisor.thread = { id: 'empty' };
    await supervisor.shutdown({ archive: true });
    assert.equal(JSON.parse(readFileSync(statePath, 'utf-8')).status, 'archived');
  });

  it('publishes progressive source checkpoints only through the fenced publisher', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'codex-supervisor-publish-'));
    mkdirSync(path.join(cwd, 'src'), { recursive: true });
    const sessionId = 'codexprogress';
    const original = '<main><div data-impeccable-variants="codexprogress"><style data-impeccable-css="codexprogress"></style><div data-impeccable-variant="original"><h1>Original</h1></div></div></main>';
    writeFileSync(path.join(cwd, 'src/App.jsx'), original);
    createLiveSessionStore({ cwd, sessionId }).appendEvent({
      type: 'generate',
      id: sessionId,
      count: 3,
      generationEpoch: 1,
    });
    const first = '<main><div data-impeccable-variants="codexprogress"><style data-impeccable-css="codexprogress">@scope ([data-impeccable-variant="1"]) { h1 { color: red; } }</style><div data-impeccable-variant="original"><h1>Original</h1></div><div data-impeccable-variant="1"><h1>One</h1></div></div></main>';
    const final = '<main><div data-impeccable-variants="codexprogress"><style data-impeccable-css="codexprogress">@scope ([data-impeccable-variant="1"]) { h1 { color: red; } }\n@scope ([data-impeccable-variant="2"]) { h1 { color: green; } }\n@scope ([data-impeccable-variant="3"]) { h1 { color: blue; } }</style><div data-impeccable-variant="original"><h1>Original</h1></div><div data-impeccable-variant="1"><h1>One</h1></div><div data-impeccable-variant="2"><h1>Two</h1></div><div data-impeccable-variant="3"><h1>Three</h1></div></div></main>';
    const client = fakeClient();
    let turn = 0;
    client.startTurn = async ({ input, onStarted, onAgentMessage }) => {
      turn += 1;
      onStarted?.(`turn-${turn}`);
      const prompt = input.find((item) => item.type === 'text').text;
      const artifactPath = JSON.parse(prompt.match(/Return exactly one file whose path is ("[^"]+")/)[1]);
      const message = JSON.stringify({ files: [{ path: artifactPath, content: turn === 1 ? first : final }] });
      await onAgentMessage?.(message);
      return { message };
    };
    const replies = [];
    const checkpoints = [];
    const phases = [];
    const supervisor = new CodexLiveWorkerSupervisor({
      cwd,
      base: 'http://localhost:1',
      token: 'token',
      client,
      config: { model: null, effort: 'low', delivery: 'progressive', maxArtifactBytes: 2_000_000 },
      statePath: path.join(cwd, '.impeccable/live/codex-worker.json'),
      scriptsDir: path.join(cwd, 'skill/scripts'),
      reply: async (_base, _token, value) => { replies.push(value); },
      publishCheckpoint: async (_base, _token, value) => { checkpoints.push(value); },
      publishPhase: async (_base, _token, value) => { phases.push(value); },
    });
    supervisor.thread = { id: 'live-worker-thread' };
    supervisor.model = client.models[0];

    await supervisor.processGeneration({
      type: 'generate',
      id: sessionId,
      count: 3,
      action: 'impeccable',
      scaffold: { file: 'src/App.jsx' },
    });

    assert.equal(checkpoints.length, 2);
    assert.deepEqual(checkpoints.map((item) => item.arrivedVariants), [1, 3]);
    assert.deepEqual(phases.map((item) => item.phase), [
      'first_variant_generating',
      'first_variant_validating',
      'remaining_variants_generating',
      'remaining_variants_validating',
    ]);
    assert.equal(replies.at(-1).type, 'done');
    assert.equal((readFileSync(path.join(cwd, 'src/App.jsx'), 'utf-8').match(/data-impeccable-variant="1"/g) || []).length, 2, 'selector and variant 1 remain once each');
    const snapshot = createLiveSessionStore({ cwd, sessionId }).getSnapshot(sessionId, { includeCompleted: true });
    assert.equal(snapshot.arrivedVariants, 3);
    assert.equal(snapshot.publishedRevision, 2);
  });
});

function createSupervisor({ cwd, statePath, client }) {
  return new CodexLiveWorkerSupervisor({
    cwd,
    base: 'http://localhost:1',
    token: 'token',
    client,
    config: { model: null, effort: 'low', delivery: 'progressive', maxArtifactBytes: 2_000_000 },
    statePath,
    scriptsDir: path.join(cwd, 'skill/scripts'),
  });
}

function fakeClient() {
  const calls = {
    connect: 0,
    listModels: 0,
    startDedicatedThread: [],
    resumeDedicatedThread: [],
    reconnect: 0,
    interruptTurn: [],
    archiveThread: [],
    close: 0,
  };
  const models = [{
    id: 'gpt-5.3-codex-spark',
    model: 'gpt-5.3-codex-spark',
    supportedReasoningEfforts: [{ reasoningEffort: 'low' }],
  }];
  return {
    calls,
    models,
    async connect() { calls.connect += 1; },
    async listModels() { calls.listModels += 1; return models; },
    async startDedicatedThread(params) { calls.startDedicatedThread.push(params); return { id: 'new-live-thread' }; },
    async resumeDedicatedThread(threadId, params) {
      calls.resumeDedicatedThread.push({ threadId, ...params });
      return { id: threadId };
    },
    async reconnect({ threadId, resumeParams }) {
      calls.reconnect += 1;
      calls.resumeDedicatedThread.push({ threadId, ...resumeParams });
      return { id: threadId };
    },
    async startTurn() { return { message: 'READY' }; },
    async interruptTurn(threadId, turnId) { calls.interruptTurn.push({ threadId, turnId }); },
    async archiveThread(threadId) { calls.archiveThread.push({ threadId }); },
    async close() { calls.close += 1; },
  };
}
