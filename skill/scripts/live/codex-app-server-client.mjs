import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const DEFAULT_CLIENT_INFO = {
  name: 'impeccable_live',
  title: 'Impeccable Live',
  version: '0.0.1',
};

function modelSearchText(model) {
  return [model?.id, model?.model, model?.displayName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * Pick a low-latency visible model without depending on a particular catalog
 * version. The caller still owns the model list and may override this choice.
 */
export function selectFastCodexModel(models = []) {
  const visible = models.filter((model) => model && !model.hidden);
  const preferences = [
    (model) => /codex/.test(modelSearchText(model)) && /spark/.test(modelSearchText(model)),
    (model) => /codex/.test(modelSearchText(model)) && /mini/.test(modelSearchText(model)),
    (model) => /mini/.test(modelSearchText(model)),
    (model) => model.isDefault,
  ];

  for (const preference of preferences) {
    const match = visible.find(preference);
    if (match) return match;
  }
  return visible[0] || null;
}

/** Pick the strongest visible general Codex model for design-sensitive work. */
export function selectQualityCodexModel(models = []) {
  const visible = models.filter((model) => model && !model.hidden);
  const preferences = [
    (model) => /5\.6/.test(modelSearchText(model)) && /sol/.test(modelSearchText(model)),
    (model) => model.isDefault && !/(?:spark|mini)/.test(modelSearchText(model)),
    (model) => !/(?:spark|mini)/.test(modelSearchText(model)),
    (model) => model.isDefault,
  ];

  for (const preference of preferences) {
    const match = visible.find(preference);
    if (match) return match;
  }
  return visible[0] || null;
}

/** Pick the least expensive supported effort, falling back to the catalog default. */
export function selectLowestReasoningEffort(model = {}) {
  const efforts = (model.supportedReasoningEfforts || [])
    .map((option) => typeof option === 'string' ? option : option?.reasoningEffort)
    .filter(Boolean);
  for (const candidate of ['none', 'minimal', 'low']) {
    if (efforts.includes(candidate)) return candidate;
  }
  return model.defaultReasoningEffort || efforts[0] || 'low';
}

export const selectFastModel = selectFastCodexModel;
export const selectLowestEffort = selectLowestReasoningEffort;

export class CodexAppServerError extends Error {
  constructor(message, { code, data, cause } = {}) {
    super(message, { cause });
    this.name = 'CodexAppServerError';
    if (code !== undefined) this.code = code;
    if (data !== undefined) this.data = data;
  }
}

function requireString(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

function asError(error, fallback) {
  if (error instanceof Error) return error;
  return new CodexAppServerError(fallback, { data: error });
}

export class CodexAppServerClient {
  constructor({
    command = 'codex',
    args = ['app-server', '--stdio'],
    cwd = process.cwd(),
    env = process.env,
    spawnFactory = spawn,
    clock = () => performance.now(),
    clientInfo = DEFAULT_CLIENT_INFO,
    initializeParams = {},
    requestTimeoutMs = 30_000,
    turnTimeoutMs = 120_000,
  } = {}) {
    this.command = command;
    this.args = [...args];
    this.cwd = cwd;
    this.env = env;
    this.spawnFactory = spawnFactory;
    this.clock = clock;
    this.clientInfo = { ...DEFAULT_CLIENT_INFO, ...clientInfo };
    this.initializeParams = { ...initializeParams };
    this.requestTimeoutMs = requestTimeoutMs;
    this.turnTimeoutMs = turnTimeoutMs;

    this.process = null;
    this.state = 'disconnected';
    this.connectionGeneration = 0;
    this.lastExit = null;
    this.stderr = '';
    this.initializeResult = null;
    this.connectedAt = null;

    this._nextRequestId = 1;
    this._pending = new Map();
    this._notificationListeners = new Set();
    this._disconnectListeners = new Set();
    this._dedicatedThreadIds = new Set();
    this._connectPromise = null;
    this._stdoutBuffer = '';
    this._failedGeneration = 0;
  }

  get connected() {
    return this.state === 'connected';
  }

  get dedicatedThreadIds() {
    return [...this._dedicatedThreadIds];
  }

  async connect() {
    if (this.connected) return this;
    if (this._connectPromise) return this._connectPromise;

    this._connectPromise = this._connect();
    try {
      return await this._connectPromise;
    } finally {
      this._connectPromise = null;
    }
  }

  async _connect() {
    if (this.state !== 'disconnected') {
      throw new CodexAppServerError(`cannot connect while client is ${this.state}`);
    }

    this.state = 'connecting';
    this.lastExit = null;
    this.stderr = '';
    this._stdoutBuffer = '';
    const generation = ++this.connectionGeneration;
    const startedAt = this.clock();
    let child;
    try {
      child = this.spawnFactory(this.command, this.args, {
        cwd: this.cwd,
        env: this.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this._bindProcess(child, generation);
      this.process = child;

      this.initializeResult = await this.request('initialize', {
        ...this.initializeParams,
        clientInfo: this.clientInfo,
      });
      this._send({ method: 'initialized', params: {} });
      this.connectedAt = this.clock();
      this.startupMs = this.connectedAt - startedAt;
      this.state = 'connected';
      return this;
    } catch (error) {
      this._failConnection(asError(error, 'failed to connect to Codex app-server'), generation);
      child?.stdin?.end?.();
      child?.kill?.('SIGTERM');
      throw error;
    }
  }

  _bindProcess(child, generation) {
    if (!child?.stdin || !child?.stdout) {
      throw new TypeError('spawnFactory must return a child process with stdin and stdout');
    }

    child.stdout.setEncoding?.('utf8');
    child.stderr?.setEncoding?.('utf8');
    child.stdout.on('data', (chunk) => this._onStdout(chunk, generation));
    child.stderr?.on('data', (chunk) => {
      if (generation === this.connectionGeneration) this.stderr += String(chunk);
    });
    child.stdin.on?.('error', (error) => this._failConnection(
      new CodexAppServerError(`Codex app-server stdin error: ${error.message}`, { cause: error }),
      generation,
    ));
    child.once('error', (error) => this._failConnection(
      new CodexAppServerError(`Codex app-server process error: ${error.message}`, { cause: error }),
      generation,
    ));
    child.once('exit', (code, signal) => {
      const suffix = signal ? `signal ${signal}` : `code ${code}`;
      this._failConnection(new CodexAppServerError(`Codex app-server exited with ${suffix}`), generation, {
        code,
        signal,
      });
    });
  }

  _onStdout(chunk, generation) {
    if (generation !== this.connectionGeneration || this.state === 'disconnected' || this.state === 'closing') {
      return;
    }
    this._stdoutBuffer += String(chunk);
    let newline;
    while ((newline = this._stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this._stdoutBuffer.slice(0, newline).trim();
      this._stdoutBuffer = this._stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      try {
        this._onMessage(JSON.parse(line));
      } catch (error) {
        this._emitNotification({
          method: 'client/protocol-error',
          params: { line, error: error.message },
          receivedAt: this.clock(),
        });
      }
    }
  }

  _onMessage(message) {
    if (message?.id !== undefined && message?.id !== null && this._pending.has(message.id)) {
      const pending = this._pending.get(message.id);
      this._pending.delete(message.id);
      if (pending.timer) clearTimeout(pending.timer);
      if (message.error) {
        const detail = typeof message.error.message === 'string'
          ? message.error.message
          : JSON.stringify(message.error);
        pending.reject(new CodexAppServerError(`${pending.method}: ${detail}`, {
          code: message.error.code,
          data: message.error.data,
        }));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message?.method) {
      this._emitNotification({ ...message, receivedAt: this.clock() });
    }
  }

  _emitNotification(notification) {
    for (const entry of [...this._notificationListeners]) {
      if (entry.method && entry.method !== notification.method) continue;
      try {
        entry.listener(notification);
      } catch {
        // A consumer exception must not break protocol dispatch for other listeners.
      }
    }
  }

  _send(message) {
    if (!this.process || this.state === 'disconnected' || this.state === 'closing') {
      throw new CodexAppServerError('Codex app-server is not connected');
    }
    try {
      this.process.stdin.write(`${JSON.stringify(message)}\n`);
    } catch (error) {
      throw new CodexAppServerError('failed to write to Codex app-server', { cause: error });
    }
  }

  request(method, params = {}, { timeoutMs = this.requestTimeoutMs } = {}) {
    requireString(method, 'method');
    if (!this.process || this.state === 'disconnected' || this.state === 'closing') {
      return Promise.reject(new CodexAppServerError('Codex app-server is not connected'));
    }

    const id = this._nextRequestId++;
    return new Promise((resolve, reject) => {
      let timer = null;
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        timer = setTimeout(() => {
          this._pending.delete(id);
          reject(new CodexAppServerError(`${method} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        timer.unref?.();
      }
      this._pending.set(id, { method, resolve, reject, timer, sentAt: this.clock() });
      try {
        this._send({ method, id, params });
      } catch (error) {
        this._pending.delete(id);
        if (timer) clearTimeout(timer);
        reject(error);
      }
    });
  }

  notify(method, params = {}) {
    requireString(method, 'method');
    this._send({ method, params });
  }

  onNotification(method, listener) {
    if (typeof method === 'function') {
      listener = method;
      method = null;
    }
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    const entry = { method, listener };
    this._notificationListeners.add(entry);
    return () => this._notificationListeners.delete(entry);
  }

  async listModels(params = {}) {
    const result = await this.request('model/list', {
      includeHidden: false,
      limit: 100,
      ...params,
    });
    return result?.data || [];
  }

  async selectFastModel(params = {}) {
    return selectFastCodexModel(await this.listModels(params));
  }

  async startDedicatedThread(params) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      throw new TypeError('dedicated thread parameters are required');
    }
    const result = await this.request('thread/start', { ...params });
    const threadId = requireString(result?.thread?.id, 'thread/start result.thread.id');
    this._dedicatedThreadIds.add(threadId);
    return result.thread;
  }

  async resumeDedicatedThread(threadId, params = {}) {
    requireString(threadId, 'threadId');
    if (params.history !== undefined || params.path !== undefined) {
      throw new TypeError('dedicated threads may only be resumed by explicit threadId');
    }
    const result = await this.request('thread/resume', { ...params, threadId });
    const resumedId = requireString(result?.thread?.id || threadId, 'thread/resume result.thread.id');
    if (resumedId !== threadId) {
      throw new CodexAppServerError(`thread/resume returned unexpected thread ${resumedId}`);
    }
    this._dedicatedThreadIds.add(threadId);
    return result.thread;
  }

  _requireDedicatedThread(threadId) {
    requireString(threadId, 'threadId');
    if (!this._dedicatedThreadIds.has(threadId)) {
      throw new CodexAppServerError(
        `thread ${threadId} is not owned by this client; start or explicitly resume a dedicated thread first`,
      );
    }
  }

  async startTurn({ threadId, input, timeoutMs = this.turnTimeoutMs, onStarted, onAgentMessage, ...params }) {
    this._requireDedicatedThread(threadId);
    const normalizedInput = typeof input === 'string'
      ? [{ type: 'text', text: input }]
      : input;
    if (!Array.isArray(normalizedInput) || normalizedInput.length === 0) {
      throw new TypeError('input must be a non-empty string or input array');
    }

    const requestedAt = this.clock();
    let turnId = null;
    let started = null;
    let completed = null;
    const agentMessages = [];
    const agentMessageCallbacks = [];
    let firstAgentMessageAt = null;
    const buffered = [];
    let completionResolve;
    let completionReject;
    let completionTimer = null;
    const completionPromise = new Promise((resolve, reject) => {
      completionResolve = resolve;
      completionReject = reject;
    });
    completionPromise.catch(() => {});

    const consider = (notification) => {
      const notificationThreadId = notification.params?.threadId;
      const notificationTurnId = notification.params?.turnId || notification.params?.turn?.id;
      if (notificationThreadId !== threadId) return;
      if (!turnId) {
        buffered.push(notification);
        return;
      }
      if (notificationTurnId !== turnId) return;
      if (notification.method === 'turn/started') started = notification;
      if (notification.method === 'item/completed'
        && notification.params?.item?.type === 'agentMessage'
        && typeof notification.params.item.text === 'string') {
        const message = notification.params.item.text;
        agentMessages.push(message);
        if (firstAgentMessageAt == null) firstAgentMessageAt = notification.receivedAt ?? this.clock();
        if (typeof onAgentMessage === 'function') {
          agentMessageCallbacks.push(Promise.resolve().then(() => onAgentMessage(message, {
            threadId,
            turnId,
            notification,
          })));
        }
      }
      if (notification.method === 'turn/completed') {
        completed = notification;
        completionResolve(notification);
      }
    };

    const unsubscribe = this.onNotification(consider);
    const onDisconnect = (error) => completionReject(error);
    this._disconnectListeners.add(onDisconnect);
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      completionTimer = setTimeout(() => {
        completionReject(new CodexAppServerError(`turn completion timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      completionTimer.unref?.();
    }

    try {
      const result = await this.request('turn/start', {
        ...params,
        threadId,
        input: normalizedInput,
      }, { timeoutMs });
      turnId = requireString(result?.turn?.id, 'turn/start result.turn.id');
      if (typeof onStarted === 'function') onStarted(turnId, result.turn);
      for (const notification of buffered.splice(0)) consider(notification);
      await completionPromise;
      await Promise.all(agentMessageCallbacks);
      const completedAt = completed?.receivedAt ?? this.clock();
      return {
        threadId,
        turnId,
        turn: completed?.params?.turn || result.turn,
        startResponse: result,
        started,
        completed,
        status: completed?.params?.turn?.status || result.turn?.status || null,
        agentMessages,
        message: agentMessages.at(-1) || null,
        requestedAt,
        firstAgentMessageAt,
        firstAgentMessageMs: firstAgentMessageAt == null ? null : firstAgentMessageAt - requestedAt,
        completedAt,
        durationMs: completedAt - requestedAt,
      };
    } finally {
      unsubscribe();
      this._disconnectListeners.delete(onDisconnect);
      if (completionTimer) clearTimeout(completionTimer);
    }
  }

  interruptTurn(threadId, turnId) {
    this._requireDedicatedThread(threadId);
    requireString(turnId, 'turnId');
    return this.request('turn/interrupt', { threadId, turnId });
  }

  async unsubscribeThread(threadId) {
    this._requireDedicatedThread(threadId);
    return this.request('thread/unsubscribe', { threadId });
  }

  async archiveThread(threadId) {
    this._requireDedicatedThread(threadId);
    const result = await this.request('thread/archive', { threadId });
    this._dedicatedThreadIds.delete(threadId);
    return result;
  }

  async reconnect({ threadId, resumeParams = {} } = {}) {
    if (threadId !== undefined) requireString(threadId, 'threadId');
    await this.disconnect();
    await this.connect();
    if (threadId !== undefined) return this.resumeDedicatedThread(threadId, resumeParams);
    return this;
  }

  async disconnect() {
    if (this.state === 'disconnected') return;
    const child = this.process;
    const generation = this.connectionGeneration;
    this.state = 'closing';
    this.process = null;
    try {
      child?.stdin?.end?.();
    } finally {
      child?.kill?.('SIGTERM');
      this._failConnection(new CodexAppServerError('Codex app-server connection closed'), generation);
    }
  }

  async close({ threadId, archive = false, unsubscribe = false } = {}) {
    if (threadId !== undefined && this.connected) {
      if (archive) await this.archiveThread(threadId);
      else if (unsubscribe) await this.unsubscribeThread(threadId);
    }
    await this.disconnect();
    this._notificationListeners.clear();
    this._dedicatedThreadIds.clear();
  }

  _failConnection(error, generation, exit = null) {
    if (generation !== this.connectionGeneration) return;
    if (this._failedGeneration === generation) {
      if (exit && !this.lastExit) this.lastExit = { ...exit, at: this.clock() };
      return;
    }
    this._failedGeneration = generation;
    if (exit) this.lastExit = { ...exit, at: this.clock() };
    this.state = 'disconnected';
    this.process = null;
    for (const pending of this._pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this._pending.clear();
    for (const listener of [...this._disconnectListeners]) listener(error);
  }
}

export function createCodexAppServerClient(options) {
  return new CodexAppServerClient(options);
}
