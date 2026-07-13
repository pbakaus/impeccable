import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { describe, it } from 'node:test';

import {
  CodexAppServerClient,
  CodexAppServerError,
  selectFastCodexModel,
  selectLowestReasoningEffort,
  selectQualityCodexModel,
} from '../skill/scripts/live/codex-app-server-client.mjs';

class FakeChild extends EventEmitter {
  constructor(onMessage) {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.messages = [];
    this.killedWith = null;
    this.stdinEnded = false;
    let buffer = '';
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        buffer += String(chunk);
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) {
            const message = JSON.parse(line);
            this.messages.push(message);
            onMessage?.(message, this);
          }
        }
        callback();
      },
      final: (callback) => {
        this.stdinEnded = true;
        callback();
      },
    });
  }

  send(message) {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  sendRaw(text) {
    this.stdout.write(text);
  }

  respond(request, result) {
    this.send({ id: request.id, result });
  }

  fail(request, error) {
    this.send({ id: request.id, error });
  }

  kill(signal) {
    this.killedWith = signal;
    queueMicrotask(() => this.emit('exit', null, signal));
    return true;
  }
}

function createHarness(handler = () => {}) {
  const children = [];
  const spawnCalls = [];
  const spawnFactory = (command, args, options) => {
    spawnCalls.push({ command, args, options });
    const child = new FakeChild((message, process) => {
      if (message.method === 'initialize' && message.id !== undefined) {
        process.respond(message, { userAgent: 'fake-app-server' });
        return;
      }
      handler(message, process, children.length);
    });
    children.push(child);
    return child;
  };
  return { children, spawnCalls, spawnFactory };
}

function makeClient(harness, options = {}) {
  let now = 0;
  return new CodexAppServerClient({
    command: '/fake/codex',
    cwd: '/workspace',
    spawnFactory: harness.spawnFactory,
    clock: () => ++now,
    requestTimeoutMs: 1_000,
    turnTimeoutMs: 1_000,
    ...options,
  });
}

async function connectClient(handler, options) {
  const harness = createHarness(handler);
  const client = makeClient(harness, options);
  await client.connect();
  return { client, harness, child: harness.children[0] };
}

describe('Codex app-server model selection', () => {
  it('prefers visible Codex Spark, then Codex mini, other mini, and the default', () => {
    const defaultModel = { id: 'gpt-5', isDefault: true };
    const otherMini = { id: 'gpt-5-mini' };
    const codexMini = { id: 'gpt-5-codex-mini' };
    const spark = { id: 'gpt-5.3-codex-spark' };

    assert.equal(selectFastCodexModel([
      { ...spark, hidden: true }, defaultModel, otherMini, codexMini, spark,
    ]), spark);
    assert.equal(selectFastCodexModel([defaultModel, otherMini, codexMini]), codexMini);
    assert.equal(selectFastCodexModel([defaultModel, otherMini]), otherMini);
    assert.equal(selectFastCodexModel([defaultModel]), defaultModel);
    assert.equal(selectFastCodexModel([{ id: 'first' }]).id, 'first');
    assert.equal(selectFastCodexModel([]), null);
  });

  it('chooses none, minimal, or low before the catalog fallback', () => {
    assert.equal(selectLowestReasoningEffort({
      supportedReasoningEfforts: [{ reasoningEffort: 'high' }, { reasoningEffort: 'none' }],
    }), 'none');
    assert.equal(selectLowestReasoningEffort({
      supportedReasoningEfforts: ['high', 'minimal', 'low'],
    }), 'minimal');
    assert.equal(selectLowestReasoningEffort({
      supportedReasoningEfforts: [{ reasoningEffort: 'medium' }],
      defaultReasoningEffort: 'medium',
    }), 'medium');
    assert.equal(selectLowestReasoningEffort({}), 'low');
  });

  it('prefers the visible 5.6 Sol model for design-sensitive generation', () => {
    const spark = { id: 'gpt-5.3-codex-spark', isDefault: true };
    const mini = { id: 'gpt-5.4-mini' };
    const sol = { id: 'gpt-5.6-sol' };
    assert.equal(selectQualityCodexModel([spark, mini, sol]), sol);
    assert.equal(selectQualityCodexModel([{ ...sol, hidden: true }, spark, { id: 'gpt-5.5' }]).id, 'gpt-5.5');
    assert.equal(selectQualityCodexModel([]), null);
  });
});

describe('Codex app-server transport', () => {
  it('spawns stdio JSONL and completes initialize/initialized exactly once', async () => {
    const { client, harness, child } = await connectClient();

    assert.equal(client.connected, true);
    assert.deepEqual(harness.spawnCalls[0], {
      command: '/fake/codex',
      args: ['app-server', '--stdio'],
      options: {
        cwd: '/workspace',
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    });
    assert.equal(child.messages[0].method, 'initialize');
    assert.equal(child.messages[0].params.clientInfo.name, 'impeccable_live');
    assert.deepEqual(child.messages[1], { method: 'initialized', params: {} });
    assert.equal(client.initializeResult.userAgent, 'fake-app-server');
    assert.equal(client.startupMs > 0, true);

    await client.connect();
    assert.equal(harness.children.length, 1);
    await client.close();
  });

  it('maps out-of-order responses, exposes notifications, and isolates listener errors', async () => {
    const pending = [];
    const { client, child } = await connectClient((message, process) => {
      if (message.method === 'first' || message.method === 'second') {
        pending.push(message);
        if (pending.length === 2) {
          process.respond(pending[1], { value: 2 });
          process.respond(pending[0], { value: 1 });
        }
      }
    });
    const notifications = [];
    client.onNotification('turn/started', () => { throw new Error('consumer failure'); });
    const unsubscribe = client.onNotification('turn/started', (notification) => {
      notifications.push(notification);
    });

    const [first, second] = await Promise.all([
      client.request('first'),
      client.request('second'),
    ]);
    child.send({ method: 'turn/started', params: { threadId: 't1' } });
    child.sendRaw('{not valid json}\n');
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(first, { value: 1 });
    assert.deepEqual(second, { value: 2 });
    assert.equal(notifications.length, 1);
    assert.equal(typeof notifications[0].receivedAt, 'number');
    unsubscribe();
    await client.close();
  });

  it('lists models and surfaces structured request errors', async () => {
    const models = [{ id: 'gpt-5.3-codex-spark', hidden: false }];
    const { client } = await connectClient((message, process) => {
      if (message.method === 'model/list') process.respond(message, { data: models });
      if (message.method === 'explode') {
        process.fail(message, { code: -32_000, message: 'bad request', data: { retry: false } });
      }
    });

    assert.deepEqual(await client.listModels(), models);
    assert.equal((await client.selectFastModel()).id, models[0].id);
    await assert.rejects(client.request('explode'), (error) => {
      assert.equal(error instanceof CodexAppServerError, true);
      assert.equal(error.code, -32_000);
      assert.deepEqual(error.data, { retry: false });
      return true;
    });
    await client.close();
  });

  it('rejects every pending request immediately when the process exits', async () => {
    const { client, child } = await connectClient();
    const first = client.request('never-returns');
    const second = client.request('also-never-returns');

    child.emit('exit', 17, null);

    await assert.rejects(first, /exited with code 17/);
    await assert.rejects(second, /exited with code 17/);
    assert.equal(client.connected, false);
    assert.equal(client.lastExit.code, 17);
  });
});

describe('dedicated Codex worker threads', () => {
  it('starts and resumes only explicit dedicated thread IDs, with no discovery request', async () => {
    const methods = [];
    const { client } = await connectClient((message, process) => {
      methods.push(message.method);
      if (message.method === 'thread/start') {
        process.respond(message, { thread: { id: 'live-worker-1', ephemeral: false } });
      }
      if (message.method === 'thread/resume') {
        process.respond(message, { thread: { id: message.params.threadId } });
      }
    });

    await assert.rejects(
      client.startTurn({ threadId: 'desktop-thread', input: 'work' }),
      /not owned by this client/,
    );
    await assert.rejects(client.resumeDedicatedThread('', {}), /non-empty string/);
    await assert.rejects(
      client.resumeDedicatedThread('live-worker-1', { path: '/desktop/rollout' }),
      /only be resumed by explicit threadId/,
    );

    const started = await client.startDedicatedThread({
      cwd: '/workspace',
      serviceName: 'impeccable_live_worker',
      ephemeral: false,
    });
    assert.equal(started.id, 'live-worker-1');
    const resumed = await client.resumeDedicatedThread('live-worker-1', { cwd: '/workspace' });
    assert.equal(resumed.id, 'live-worker-1');
    assert.deepEqual(client.dedicatedThreadIds, ['live-worker-1']);
    assert.equal(methods.includes('thread/list'), false);
    assert.equal(methods.includes('thread/read'), false);
    await client.close();
  });

  it('collects early and late agent messages through turn completion', async () => {
    const { client } = await connectClient((message, process) => {
      if (message.method === 'thread/start') {
        process.respond(message, { thread: { id: 'worker' } });
      }
      if (message.method === 'turn/start') {
        const common = { threadId: 'worker', turnId: 'turn-1' };
        process.send({
          method: 'turn/started',
          params: { threadId: 'worker', turn: { id: 'turn-1', status: 'inProgress' } },
        });
        process.send({
          method: 'item/completed',
          params: { ...common, item: { type: 'agentMessage', text: 'first fragment' } },
        });
        process.respond(message, { turn: { id: 'turn-1', status: 'inProgress' } });
        queueMicrotask(() => {
          process.send({
            method: 'item/completed',
            params: { ...common, item: { type: 'agentMessage', text: 'final answer' } },
          });
          process.send({
            method: 'turn/completed',
            params: { threadId: 'worker', turn: { id: 'turn-1', status: 'completed' } },
          });
        });
      }
    });
    await client.startDedicatedThread({ serviceName: 'impeccable_live_worker' });

    let startedTurnId = null;
    const deliveredMessages = [];
    const result = await client.startTurn({
      threadId: 'worker',
      input: 'Reply exactly',
      model: 'gpt-5.3-codex-spark',
      effort: 'low',
      onStarted: (turnId) => { startedTurnId = turnId; },
      onAgentMessage: async (message) => { deliveredMessages.push(message); },
    });

    assert.equal(startedTurnId, 'turn-1');
    assert.equal(result.turnId, 'turn-1');
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.agentMessages, ['first fragment', 'final answer']);
    assert.deepEqual(deliveredMessages, ['first fragment', 'final answer']);
    assert.equal(result.message, 'final answer');
    assert.equal(result.firstAgentMessageMs >= 0, true);
    assert.equal(result.started.method, 'turn/started');
    assert.equal(result.durationMs > 0, true);
    await client.close();
  });

  it('interrupts, unsubscribes, archives, and cleanly closes', async () => {
    const methods = [];
    const { client, child } = await connectClient((message, process) => {
      methods.push(message.method);
      if (message.method === 'thread/start') process.respond(message, { thread: { id: 'worker' } });
      if (message.method === 'turn/interrupt') process.respond(message, {});
      if (message.method === 'thread/unsubscribe') {
        process.respond(message, { status: 'unsubscribed' });
      }
      if (message.method === 'thread/archive') process.respond(message, {});
    });
    await client.startDedicatedThread({ serviceName: 'impeccable_live_worker' });

    await client.interruptTurn('worker', 'turn-1');
    assert.deepEqual(await client.unsubscribeThread('worker'), { status: 'unsubscribed' });
    await client.close({ threadId: 'worker', archive: true });

    assert.equal(methods.includes('turn/interrupt'), true);
    assert.equal(methods.includes('thread/unsubscribe'), true);
    assert.equal(methods.includes('thread/archive'), true);
    assert.equal(child.stdinEnded, true);
    assert.equal(child.killedWith, 'SIGTERM');
    assert.equal(client.connected, false);
    assert.deepEqual(client.dedicatedThreadIds, []);
  });

  it('reconnects to a new process and explicitly resumes the dedicated worker', async () => {
    const methods = [];
    const harness = createHarness((message, process, childCount) => {
      methods.push({ method: message.method, childCount });
      if (message.method === 'thread/start') {
        process.respond(message, { thread: { id: 'worker' } });
      }
      if (message.method === 'thread/resume') {
        process.respond(message, { thread: { id: message.params.threadId } });
      }
    });
    const client = makeClient(harness);
    await client.connect();
    await client.startDedicatedThread({ serviceName: 'impeccable_live_worker' });

    const resumed = await client.reconnect({
      threadId: 'worker',
      resumeParams: { cwd: '/workspace' },
    });

    assert.equal(harness.children.length, 2);
    assert.equal(resumed.id, 'worker');
    assert.equal(client.connectionGeneration, 2);
    assert.equal(methods.some((entry) => entry.method === 'thread/resume' && entry.childCount === 2), true);
    await client.close();
  });

  it('rejects an in-flight turn when the transport exits', async () => {
    const { client, child } = await connectClient((message, process) => {
      if (message.method === 'thread/start') process.respond(message, { thread: { id: 'worker' } });
      if (message.method === 'turn/start') {
        process.respond(message, { turn: { id: 'turn-1', status: 'inProgress' } });
      }
    });
    await client.startDedicatedThread({ serviceName: 'impeccable_live_worker' });
    const turn = client.startTurn({ threadId: 'worker', input: 'work' });
    await new Promise((resolve) => setImmediate(resolve));

    child.emit('exit', 9, null);

    await assert.rejects(turn, /exited with code 9/);
  });
});
