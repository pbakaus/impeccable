import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import {
  selectFastCodexModel,
  selectLowestReasoningEffort,
} from './codex-app-server-client.mjs';

import {
  CODEX_WORKER_OWNER,
  CODEX_WORKER_OUTPUT_SCHEMA,
  applyCodexWorkerOutput,
  buildCodexWorkerInstructions,
  buildGenerationTurnInput,
  codexWorkerStateIsOwned,
  generationIsCanceled,
  prepareCodexWorkerPhase,
  publishCodexWorkerPhase,
  readPreparedArtifact,
} from './codex-worker.mjs';
import {
  augmentEventWithAcceptHandling,
  fetchNextEvent,
  postReply,
  requiresAgentReply,
} from '../live-poll.mjs';

export const CODEX_WORKER_EVENT_TYPES = Object.freeze(['generate', 'accept', 'discard', 'prefetch']);

export class CodexLiveWorkerSupervisor {
  constructor({
    cwd,
    base,
    token,
    client,
    config,
    statePath,
    scriptsDir,
    fetchEvent = fetchNextEvent,
    handleAccept = augmentEventWithAcceptHandling,
    reply = postReply,
    publishCheckpoint = postVariantCheckpoint,
    postCleanup = postCarbonizeCleanup,
    log = () => {},
  }) {
    this.cwd = path.resolve(cwd);
    this.base = base;
    this.token = token;
    this.client = client;
    this.config = config;
    this.statePath = statePath;
    this.scriptsDir = scriptsDir;
    this.fetchEvent = fetchEvent;
    this.handleAccept = handleAccept;
    this.reply = reply;
    this.publishCheckpoint = publishCheckpoint;
    this.postCleanup = postCleanup;
    this.log = log;
    this.running = false;
    this.queue = Promise.resolve();
    this.active = null;
    this.canceled = new Set();
    this.thread = null;
    this.model = null;
    this.liveSpec = '';
  }

  async initialize() {
    this.liveSpec = readOptional(path.join(this.scriptsDir, '..', 'reference', 'live.md'));
    await this.client.connect();
    const models = await this.client.listModels();
    this.model = this.config.model
      ? models.find((model) => model.id === this.config.model || model.model === this.config.model)
      : selectFastCodexModel(models);
    if (!this.model) throw supervisorError('codex_worker_model_unavailable');

    const prior = readJson(this.statePath);
    if (codexWorkerStateIsOwned(prior, this.cwd) && prior.status !== 'archived') {
      try {
        this.thread = await this.client.resumeDedicatedThread(prior.threadId, {
          model: this.model.model || this.model.id,
          cwd: this.cwd,
          approvalPolicy: 'never',
          sandbox: 'read-only',
          baseInstructions: buildCodexWorkerInstructions(this.liveSpec),
        });
      } catch (error) {
        this.log(`resume failed; creating replacement worker thread: ${error.message}`);
      }
    }
    if (!this.thread) {
      this.thread = await this.client.startDedicatedThread({
        model: this.model.model || this.model.id,
        cwd: this.cwd,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        ephemeral: false,
        serviceName: 'impeccable_live_codex_worker',
        baseInstructions: buildCodexWorkerInstructions(this.liveSpec),
      });
    }
    this.writeState('ready');
    return this.status();
  }

  async run() {
    if (!this.thread) await this.initialize();
    this.running = true;
    while (this.running) {
      const event = await this.fetchEvent(this.base, this.token, { types: CODEX_WORKER_EVENT_TYPES });
      if (!event || event.type === 'timeout') continue;
      if (event.type === 'exit') {
        await this.cancelActive('live_exit');
        this.running = false;
        break;
      }
      if (event.type === 'accept' || event.type === 'discard') {
        this.canceled.add(event.id);
        await this.cancelActive(event.type, event.id);
        const handled = await this.handleAccept(event, this.base, this.token);
        if (event.type === 'accept' && handled?._acceptResult?.carbonize === true) {
          await this.postCleanup(this.base, this.token, {
            sessionId: event.id,
            file: handled._acceptResult.file,
            variantId: event.variantId,
            acceptResult: handled._acceptResult,
          });
        }
        continue;
      }
      if (event.type === 'generate') {
        this.queue = this.queue
          .then(() => this.processGeneration(event))
          .catch((error) => this.handleGenerationFailure(event, error));
        continue;
      }
      if (event.type === 'prefetch') continue;
      if (requiresAgentReply(event)) {
        await this.reply(this.base, this.token, {
          id: event.id,
          type: 'error',
          sourceEventType: event.type,
          message: `Experimental Codex worker does not handle ${event.type}; disable IMPECCABLE_LIVE_CODEX_WORKER for the portable foreground path.`,
        });
      }
    }
    await this.queue.catch(() => {});
    await this.shutdown({ archive: true });
  }

  async processGeneration(event) {
    if (this.isCanceled(event.id)) return;
    if (!event.scaffold?.file) event.scaffold = runDeterministicScaffold(event, {
      cwd: this.cwd,
      scriptsDir: this.scriptsDir,
    });
    this.active = { eventId: event.id, turnId: null };
    this.writeState('working', { eventId: event.id });
    try {
      if (this.config.delivery === 'progressive' && Number(event.count || 0) > 1) {
        await this.runGenerationPhase(event, 'first', 1);
        if (this.isCanceled(event.id)) return;
        await this.runGenerationPhase(event, 'final', Number(event.count));
      } else {
        await this.runGenerationPhase(event, 'atomic', Number(event.count || 1));
      }
      if (this.isCanceled(event.id)) return;
      await this.reply(this.base, this.token, {
        id: event.id,
        type: 'done',
        sourceEventType: event.type,
        file: event.scaffold.file,
      });
    } finally {
      this.active = null;
      this.writeState('ready');
    }
  }

  async runGenerationPhase(event, phase, arrivedVariants) {
    if (this.isCanceled(event.id)) return;
    const prepared = prepareCodexWorkerPhase({
      id: event.id,
      sourceFile: event.scaffold.file,
      cwd: this.cwd,
    });
    const artifact = readPreparedArtifact(prepared, {
      cwd: this.cwd,
      maxBytes: this.config.maxArtifactBytes,
    });
    const contexts = readGenerationContexts(this.cwd, this.scriptsDir, event.action);
    const input = buildGenerationTurnInput({
      event,
      phase,
      prepared,
      artifact,
      ...contexts,
    });
    const result = await this.runTurnWithReconnect({
      input,
      outputSchema: CODEX_WORKER_OUTPUT_SCHEMA,
    });
    if (this.isCanceled(event.id)) return;
    applyCodexWorkerOutput({
      output: result.answer,
      prepared,
      phase,
      expectedVariants: Number(event.count || arrivedVariants),
      cwd: this.cwd,
      maxBytes: this.config.maxArtifactBytes,
    });
    if (this.isCanceled(event.id)) return;
    const published = publishCodexWorkerPhase({ event, prepared, arrivedVariants, cwd: this.cwd });
    await this.publishCheckpoint(this.base, this.token, {
      event,
      published,
      scaffold: event.scaffold,
      arrivedVariants,
    });
  }

  async runTurnWithReconnect({ input, outputSchema }) {
    let firstError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const turn = await this.client.startTurn({
          threadId: this.thread.id,
          input,
          cwd: this.cwd,
          model: this.model.model || this.model.id,
          effort: preferredEffort(this.model, this.config.effort),
          summary: 'none',
          approvalPolicy: 'never',
          sandboxPolicy: { type: 'readOnly' },
          outputSchema,
          onStarted: (turnId) => {
            if (!this.active) return;
            this.active.turnId = turnId;
            if (this.isCanceled(this.active.eventId)) {
              this.client.interruptTurn(this.thread.id, turnId).catch(() => {});
            }
          },
        });
        return { ...turn, answer: turn.message };
      } catch (error) {
        if (!firstError) firstError = error;
        if (attempt > 0 || error.code === 'TURN_INTERRUPTED') throw error;
        this.log(`app-server turn failed; reconnecting once: ${error.message}`);
        await this.reconnect();
      }
    }
    throw firstError;
  }

  async reconnect() {
    this.thread = await this.client.reconnect({
      threadId: this.thread.id,
      resumeParams: {
        model: this.model.model || this.model.id,
        cwd: this.cwd,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        baseInstructions: buildCodexWorkerInstructions(this.liveSpec),
      },
    });
    this.writeState('ready', { reconnectedAt: new Date().toISOString() });
  }

  async cancelActive(reason, eventId = null) {
    if (!this.active) return;
    if (eventId && this.active.eventId !== eventId) return;
    this.canceled.add(this.active.eventId);
    if (this.active.turnId) {
      await this.client.interruptTurn(this.thread.id, this.active.turnId).catch(() => {});
    }
    this.log(`interrupted ${this.active.eventId}: ${reason}`);
  }

  async handleGenerationFailure(event, error) {
    if (this.isCanceled(event.id) || error.code === 'TURN_INTERRUPTED') return;
    this.log(`generation ${event.id} failed: ${error.stack || error.message}`);
    await this.reply(this.base, this.token, {
      id: event.id,
      type: 'error',
      sourceEventType: event.type,
      message: `Dedicated Codex worker failed: ${error.message}`,
    }).catch(() => {});
  }

  isCanceled(eventId) {
    return this.canceled.has(eventId) || generationIsCanceled(eventId, { cwd: this.cwd });
  }

  async shutdown({ archive = false } = {}) {
    this.running = false;
    await this.cancelActive('shutdown');
    let archived = false;
    if (archive && this.thread) {
      try {
        await this.client.archiveThread(this.thread.id);
        archived = true;
      } catch (error) {
        this.log(`thread archive failed: ${error.message}`);
      }
    }
    await this.client.close().catch(() => {});
    this.writeState(archived ? 'archived' : 'stopped', { archived });
  }

  status() {
    return {
      ok: true,
      owner: CODEX_WORKER_OWNER,
      cwd: this.cwd,
      pid: process.pid,
      status: this.active ? 'working' : 'ready',
      threadId: this.thread?.id || null,
      model: this.model?.model || this.model?.id || null,
      effort: this.model ? preferredEffort(this.model, this.config.effort) : this.config.effort,
      delivery: this.config.delivery,
      eventId: this.active?.eventId || null,
    };
  }

  writeState(status, extra = {}) {
    const state = {
      ...this.status(),
      ...extra,
      status,
      updatedAt: new Date().toISOString(),
    };
    atomicWriteJson(this.statePath, state);
    return state;
  }
}

function preferredEffort(model, requested) {
  const supported = (model?.supportedReasoningEfforts || [])
    .map((option) => typeof option === 'string' ? option : option?.reasoningEffort)
    .filter(Boolean);
  if (requested && supported.includes(requested)) return requested;
  return selectLowestReasoningEffort(model);
}

export async function postVariantCheckpoint(base, token, {
  event,
  published,
  scaffold,
  arrivedVariants,
}) {
  const response = await fetch(`${base}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      type: 'checkpoint',
      id: event.id,
      revision: published.revision,
      phase: 'cycling',
      reason: 'variants_progress',
      arrivedVariants,
      expectedVariants: event.count,
      sourceFile: scaffold.sourceFile || scaffold.file,
      previewFile: scaffold.file,
      previewMode: scaffold.previewMode || 'source',
    }),
  });
  if (!response.ok) throw supervisorError(`checkpoint_${response.status}`);
}

export async function postCarbonizeCleanup(base, token, {
  sessionId,
  file,
  variantId,
  acceptResult,
  id = randomBytes(4).toString('hex'),
}) {
  const response = await fetch(`${base}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      type: 'carbonize_cleanup',
      id,
      sessionId,
      file,
      variantId,
      acceptResult,
    }),
  });
  if (!response.ok) throw supervisorError(`carbonize_cleanup_${response.status}`);
  return { id, ...(await response.json()) };
}

export function buildDeterministicScaffoldCommand(event, scriptsDir) {
  const insert = event.mode === 'insert';
  const script = path.join(scriptsDir, insert ? 'live-insert.mjs' : 'live-wrap.mjs');
  const args = ['--id', String(event.id), '--count', String(event.count || 3)];
  const target = insert ? event.insert?.anchor || {} : event.element || {};
  if (insert) args.push('--position', String(event.insert?.position || 'after'));
  if (target.id) args.push('--element-id', String(target.id));
  const classes = Array.isArray(target.classes) ? target.classes.join(',') : target.className;
  if (classes) args.push('--classes', String(classes));
  if (target.tagName || target.tag) args.push('--tag', String(target.tagName || target.tag).toLowerCase());
  const text = String(target.textContent || target.text || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!target.id && !classes && text) args.push('--query', text);
  if (text) args.push('--text', text);
  return { script, args };
}

export function runDeterministicScaffold(event, {
  cwd = process.cwd(),
  scriptsDir,
  exec = execFileSync,
} = {}) {
  const command = buildDeterministicScaffoldCommand(event, scriptsDir);
  let output;
  try {
    output = exec(process.execPath, [command.script, ...command.args], {
      cwd,
      encoding: 'utf-8',
      timeout: 30_000,
    });
  } catch (error) {
    throw supervisorError(`codex_worker_scaffold_failed:${error.stderr || error.message}`);
  }
  let scaffold;
  try { scaffold = JSON.parse(String(output).trim()); } catch { throw supervisorError('codex_worker_scaffold_invalid'); }
  if (!scaffold?.file || scaffold.error) {
    throw supervisorError(`codex_worker_scaffold_${scaffold?.error || 'missing_file'}`);
  }
  return scaffold;
}

function readGenerationContexts(cwd, scriptsDir, action) {
  const safeAction = typeof action === 'string' && /^[a-z-]+$/.test(action) && action !== 'impeccable'
    ? action
    : null;
  return {
    product: readOptional(path.join(cwd, 'PRODUCT.md')),
    design: readOptional(path.join(cwd, 'DESIGN.md')),
    actionReference: safeAction
      ? readOptional(path.join(scriptsDir, '..', 'reference', `${safeAction}.md`))
      : '',
  };
}

function readOptional(file) {
  try { return fs.readFileSync(file, 'utf-8'); } catch { return ''; }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', 'utf-8');
  fs.renameSync(temporary, file);
}

function supervisorError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
