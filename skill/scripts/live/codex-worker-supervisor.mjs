import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import {
  selectFastCodexModel,
  selectLowestReasoningEffort,
  selectQualityCodexModel,
} from './codex-app-server-client.mjs';
import { loadContext } from '../context.mjs';
import { reconcilePublishedSourceVariants } from './generation-publisher.mjs';

import {
  CODEX_WORKER_OWNER,
  applyCodexWorkerOutput,
  buildCodexWorkerInstructions,
  buildCodexWorkerTurnInputs,
  buildGenerationTurnInput,
  codexWorkerOutputSchemaForPhase,
  codexWorkerStateIsOwned,
  generationIsCanceled,
  prepareCodexWorkerPhase,
  publishCodexWorkerPhase,
  readPreparedArtifact,
  resolveCodexWorkerSkillPath,
} from './codex-worker.mjs';
import {
  augmentEventWithAcceptHandling,
  completeAcceptHandling,
  fetchNextEvent,
  postReply,
  requiresAgentReply,
} from '../live-poll.mjs';
import { createLiveSessionStore } from './session-store.mjs';

export const CODEX_WORKER_EVENT_TYPES = Object.freeze(['generate', 'accept', 'discard', 'prefetch']);
export const CODEX_WORKER_EVENT_LEASE_MS = 15_000;

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
    completeAccept = completeAcceptHandling,
    reply = postReply,
    publishCheckpoint = postVariantCheckpoint,
    publishPhase = postAgentPhase,
    postCleanup = postCarbonizeCleanup,
    sessionStore = null,
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
    this.completeAccept = completeAccept;
    this.reply = reply;
    this.publishCheckpoint = publishCheckpoint;
    this.publishPhase = publishPhase;
    this.postCleanup = postCleanup;
    this.sessionStore = sessionStore || createLiveSessionStore({ cwd: this.cwd });
    this.log = log;
    this.running = false;
    this.queue = Promise.resolve();
    this.active = null;
    this.canceled = new Set();
    this.queuedGenerationIds = new Set();
    this.pollAbortController = null;
    this.activePoll = null;
    this.failure = null;
    this.thread = null;
    this.threadReady = Promise.resolve(null);
    this.model = null;
    this.liveSpec = '';
  }

  async initialize() {
    this.liveSpec = readOptional(path.join(this.scriptsDir, '..', 'reference', 'live.md'));
    await this.client.connect();
    const models = await this.client.listModels();
    this.model = this.config.model
      ? models.find((model) => model.id === this.config.model || model.model === this.config.model)
      : this.config.profile === 'fast'
        ? selectFastCodexModel(models)
        : selectQualityCodexModel(models);
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
      this.thread = await this.startWorkerThread();
    }
    this.threadReady = Promise.resolve(this.thread);
    this.writeState('ready');
    return this.status();
  }

  async run() {
    if (!this.thread) await this.initialize();
    this.running = true;
    this.pollAbortController = new AbortController();
    while (this.running) {
      let event;
      try {
        const poll = this.fetchEvent(this.base, this.token, {
          types: CODEX_WORKER_EVENT_TYPES,
          leaseMs: CODEX_WORKER_EVENT_LEASE_MS,
          signal: this.pollAbortController.signal,
        });
        this.activePoll = poll;
        event = await poll;
      } catch (error) {
        if (!this.running && (error?.name === 'AbortError' || this.pollAbortController.signal.aborted)) break;
        throw error;
      } finally {
        this.activePoll = null;
      }
      if (!this.running) break;
      if (!event || event.type === 'timeout') continue;
      if (event.type === 'exit') {
        await this.cancelActive('live_exit');
        this.running = false;
        break;
      }
      if (event.type === 'accept' || event.type === 'discard') {
        this.canceled.add(event.id);
        const replaceBusyThread = this.active?.eventId === event.id;
        // Cancellation fences publication synchronously. Do not make the
        // deterministic Accept/Discard path wait on a slow app-server
        // interrupt round trip before it can update source and reply.
        void this.cancelActive(event.type, event.id);
        if (replaceBusyThread) this.rotateWorkerThread(event.type);
        const handled = await this.handleAccept(event, this.base, this.token, {
          deferReply: event.type === 'accept',
        });
        if (event.type === 'accept' && handled?._acceptResult?.carbonize === true) {
          await this.postCleanup(this.base, this.token, {
            id: event.id,
            sessionId: event.id,
            file: handled._acceptResult.file,
            variantId: event.variantId,
            acceptResult: handled._acceptResult,
          });
        }
        if (handled?._completionAck?.deferred === true) {
          await this.completeAccept(handled, this.base, this.token);
        }
        continue;
      }
      if (event.type === 'generate') {
        if (this.queuedGenerationIds.has(event.id)) continue;
        this.queuedGenerationIds.add(event.id);
        this.queue = this.queue
          .then(() => this.processGeneration(event))
          .catch((error) => this.handleGenerationFailure(event, error))
          .finally(() => this.queuedGenerationIds.delete(event.id));
        continue;
      }
      if (event.type === 'prefetch') continue;
      if (requiresAgentReply(event)) {
        await this.reply(this.base, this.token, {
          id: event.id,
          type: 'error',
          sourceEventType: event.type,
          message: `Dedicated Codex worker does not handle ${event.type}; disable IMPECCABLE_LIVE_CODEX_WORKER for the portable foreground path.`,
        });
      }
    }
    await this.queue.catch(() => {});
    await this.shutdown({ archive: !this.failure });
  }

  async processGeneration(event) {
    if (this.isCanceled(event.id)) return;
    await this.threadReady;
    if (this.isCanceled(event.id)) return;
    if (!event.scaffold?.file) event.scaffold = runDeterministicScaffold(event, {
      cwd: this.cwd,
      scriptsDir: this.scriptsDir,
    });
    this.active = { eventId: event.id, turnId: null, threadId: this.thread.id };
    this.writeState('working', { eventId: event.id });
    try {
      const expectedVariants = Number(event.count || 1);
      const snapshot = this.sessionStore.getSnapshot(event.id, { includeCompleted: true });
      const sameEpoch = Number(snapshot?.generationEpoch || 1) === Number(event.generationEpoch || 1);
      let arrivedVariants = sameEpoch ? Number(snapshot?.arrivedVariants || 0) : 0;
      if (this.config.delivery === 'progressive' && expectedVariants > 1) {
        if (arrivedVariants < 1) {
          await this.runGenerationPhase(event, 'first', 1);
          arrivedVariants = 1;
        }
        if (this.isCanceled(event.id)) return;
        if (expectedVariants > 2 && arrivedVariants < 2) {
          await this.runGenerationPhase(event, 'second', 2);
          arrivedVariants = 2;
        }
        if (this.isCanceled(event.id)) return;
        if (arrivedVariants < expectedVariants) {
          await this.runGenerationPhase(event, 'final', expectedVariants);
        }
      } else if (arrivedVariants < expectedVariants) {
        await this.runGenerationPhase(event, 'atomic', expectedVariants);
      }
      if (this.isCanceled(event.id)) return;
      await this.reply(this.base, this.token, {
        id: event.id,
        type: 'done',
        sourceEventType: event.type,
        file: event.scaffold.file,
      });
    } finally {
      if (this.active?.eventId === event.id) {
        this.active = null;
        this.writeState('ready');
      }
    }
  }

  startWorkerThread() {
    return this.client.startDedicatedThread({
      model: this.model.model || this.model.id,
      cwd: this.cwd,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: false,
      serviceName: 'impeccable_live_codex_worker',
      baseInstructions: buildCodexWorkerInstructions(this.liveSpec),
    });
  }

  rotateWorkerThread(reason) {
    const priorThread = this.thread;
    const drainingQueue = this.queue;
    this.queue = Promise.resolve();
    this.thread = null;
    this.threadReady = this.startWorkerThread().then((thread) => {
      this.thread = thread;
      this.writeState('ready', {
        rotatedAt: new Date().toISOString(),
        rotationReason: reason,
      });
      return thread;
    });
    void this.threadReady.catch((error) => {
      this.writeState('error', { error: error.message, rotationReason: reason });
      this.log(`replacement worker thread failed: ${error.message}`);
    });
    if (priorThread) {
      void drainingQueue.finally(async () => {
        await this.client.archiveThread(priorThread.id).catch((error) => {
          this.log(`retired worker thread archive failed: ${error.message}`);
        });
      });
    }
    return this.threadReady;
  }

  async runGenerationPhase(event, phase, arrivedVariants) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.runGenerationPhaseOnce(event, phase, arrivedVariants);
      } catch (error) {
        const sourceChangedDuringGeneration = error?.code === 'publish_source_hash_mismatch';
        if (!sourceChangedDuringGeneration || attempt > 0 || this.isCanceled(event.id)) throw error;
        this.log(`source changed during ${event.id} ${phase}; re-preparing once before publication`);
      }
    }
  }

  async runGenerationPhaseOnce(event, phase, arrivedVariants) {
    if (this.isCanceled(event.id)) return;
    const phaseStartedAt = Date.now();
    await this.publishPhase(this.base, this.token, {
      eventId: event.id,
      phase: generationPhaseName(phase, 'generating'),
    });
    const prepared = prepareCodexWorkerPhase({
      id: event.id,
      sourceFile: event.scaffold.file,
      cwd: this.cwd,
    });
    const artifact = readPreparedArtifact(prepared, {
      cwd: this.cwd,
      maxBytes: this.config.maxArtifactBytes,
    });
    const contexts = readGenerationContexts(this.cwd, this.scriptsDir, event);
    const prompt = buildGenerationTurnInput({
      event,
      phase,
      prepared,
      artifact,
      variantPlan: this.sessionStore.getSnapshot(event.id, { includeCompleted: true })?.variantPlan || null,
      ...contexts,
    });
    const input = buildCodexWorkerTurnInputs({
      prompt,
      skillPath: resolveCodexWorkerSkillPath(this.scriptsDir),
      screenshotPath: event.screenshotPath,
      cwd: this.cwd,
    });
    let publishedFromMessage = false;
    let publicationPromise = null;
    let earlyCandidateError = null;
    const publishCandidate = async (answer) => {
      if (publishedFromMessage || this.isCanceled(event.id)) return;
      if (!publicationPromise) {
        publicationPromise = (async () => {
          await this.publishPhase(this.base, this.token, {
            eventId: event.id,
            phase: generationPhaseName(phase, 'validating'),
            durationMs: Date.now() - phaseStartedAt,
          });
          const applied = applyCodexWorkerOutput({
            output: answer,
            prepared,
            phase,
            expectedVariants: Number(event.count || arrivedVariants),
            cwd: this.cwd,
            maxBytes: this.config.maxArtifactBytes,
          });
          if (!prepared.previewMode && (phase === 'second' || phase === 'final')) {
            const candidatePath = path.resolve(this.cwd, prepared.artifactFile);
            const reconciled = reconcilePublishedSourceVariants({
              current: artifact.content,
              candidate: fs.readFileSync(candidatePath, 'utf-8'),
              priorArrived: Math.max(1, arrivedVariants - 1),
            });
            if (!reconciled.ok) throw supervisorError(`reconcile_${reconciled.error}`);
            fs.writeFileSync(candidatePath, reconciled.content, 'utf-8');
          }
          if (applied.plan) {
            this.sessionStore.appendEvent({ type: 'variant_plan', id: event.id, plan: applied.plan });
          }
          if (this.isCanceled(event.id)) return;
          const published = publishCodexWorkerPhase({ event, prepared, arrivedVariants, cwd: this.cwd });
          await this.publishCheckpoint(this.base, this.token, {
            event,
            published,
            scaffold: event.scaffold,
            arrivedVariants,
          });
          publishedFromMessage = true;
        })();
      }
      const pendingPublication = publicationPromise;
      try {
        await pendingPublication;
      } catch (error) {
        earlyCandidateError = error;
      } finally {
        if (publicationPromise === pendingPublication) publicationPromise = null;
      }
    };
    if (this.isCanceled(event.id)) return;
    const result = await this.runTurnWithReconnect({
      input,
      outputSchema: codexWorkerOutputSchemaForPhase(phase, Number(event.count || arrivedVariants)),
      onAgentMessage: publishCandidate,
      eventId: event.id,
    });
    if (this.isCanceled(event.id)) return;
    if (!publishedFromMessage) await publishCandidate(result.answer);
    if (!publishedFromMessage) throw earlyCandidateError || supervisorError('worker_output_not_published');
  }

  async runTurnWithReconnect({ input, outputSchema, onAgentMessage, eventId = this.active?.eventId }) {
    let firstError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const threadId = this.thread.id;
        const turn = await this.client.startTurn({
          threadId,
          input,
          cwd: this.cwd,
          model: this.model.model || this.model.id,
          effort: preferredEffort(this.model, this.config.effort),
          summary: 'none',
          approvalPolicy: 'never',
          sandboxPolicy: { type: 'readOnly' },
          outputSchema,
          onAgentMessage,
          onStarted: (turnId) => {
            if (this.active?.eventId === eventId) this.active.turnId = turnId;
            if (eventId && this.isCanceled(eventId)) {
              this.client.interruptTurn(threadId, turnId).catch(() => {});
            }
          },
        });
        return { ...turn, answer: turn.message };
      } catch (error) {
        if (!firstError) firstError = error;
        if (eventId && this.isCanceled(eventId)) throw error;
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
    const threadId = this.active.threadId || this.thread?.id;
    if (threadId && this.active.turnId) {
      await this.client.interruptTurn(threadId, this.active.turnId).catch(() => {});
    }
    this.log(`interrupted ${this.active.eventId}: ${reason}`);
  }

  async handleGenerationFailure(event, error) {
    if (this.isCanceled(event.id) || error.code === 'TURN_INTERRUPTED') return;
    this.log(`generation ${event.id} failed: ${error.stack || error.message}`);
    this.failure = {
      eventId: event.id,
      error: error.message,
      failedAt: new Date().toISOString(),
    };
    this.running = false;
    this.pollAbortController?.abort();
    if (this.activePoll) {
      await Promise.race([
        this.activePoll.catch(() => null),
        new Promise((resolve) => {
          const timer = setTimeout(resolve, 250);
          timer.unref?.();
        }),
      ]);
    }
    await this.reply(this.base, this.token, {
      id: event.id,
      type: 'retry',
      sourceEventType: event.type,
    }).catch(() => {});
    this.writeState('failed', this.failure);
  }

  isCanceled(eventId) {
    return this.canceled.has(eventId) || generationIsCanceled(eventId, { cwd: this.cwd });
  }

  async shutdown({ archive = false } = {}) {
    this.running = false;
    await this.cancelActive('shutdown');
    await Promise.race([
      this.threadReady.catch(() => null),
      new Promise((resolve) => {
        const timer = setTimeout(resolve, 1_000);
        timer.unref?.();
      }),
    ]);
    let archived = false;
    if (archive && this.thread) {
      try {
        await this.client.archiveThread(this.thread.id);
        archived = true;
      } catch (error) {
        if (/no rollout found/i.test(String(error?.message || ''))) {
          archived = true;
          this.log('empty worker thread had no persisted rollout; treating it as archived');
        } else {
          this.log(`thread archive failed: ${error.message}`);
        }
      }
    }
    await this.client.close().catch(() => {});
    this.writeState(
      this.failure ? 'failed' : archived ? 'archived' : 'stopped',
      { archived, ...(this.failure || {}) },
    );
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
      profile: this.config.profile,
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

function generationPhaseName(phase, state) {
  if (phase === 'first') return `first_variant_${state}`;
  if (phase === 'second') return `second_variant_${state}`;
  return `remaining_variants_${state}`;
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

export async function postAgentPhase(base, token, {
  eventId,
  phase,
  durationMs,
}) {
  const response = await fetch(`${base}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      type: 'agent_phase',
      id: eventId,
      phase,
      owner: CODEX_WORKER_OWNER,
      ...(Number.isFinite(durationMs) ? { durationMs } : {}),
    }),
  });
  if (!response.ok) throw supervisorError(`agent_phase_${response.status}`);
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

function readGenerationContexts(cwd, scriptsDir, event) {
  const context = loadContext(cwd);
  const action = event?.action;
  const safeAction = typeof action === 'string' && /^[a-z-]+$/.test(action) && action !== 'impeccable'
    ? action
    : null;
  return {
    product: context.product || '',
    design: context.design || '',
    actionReference: safeAction
      ? readOptional(path.join(scriptsDir, '..', 'reference', `${safeAction}.md`))
      : '',
    contextMetadata: {
      productPath: context.productPath,
      designPath: context.designPath,
      projectRoot: context.projectRoot,
      repoRoot: context.repoRoot,
      isMonorepo: context.isMonorepo,
    },
    sourceNeighborhood: readSourceNeighborhood(cwd, context.projectRoot, event?.scaffold?.sourceFile || event?.scaffold?.file),
  };
}

function readSourceNeighborhood(cwd, projectRoot, sourceFile) {
  const roots = [projectRoot, cwd].filter(Boolean).map((value) => path.resolve(value));
  const result = {};
  let totalBytes = 0;
  const maxBytes = 180_000;
  const candidateNames = [
    sourceFile,
    'package.json',
    'src/styles.css',
    'src/index.css',
    'src/globals.css',
    'app/globals.css',
    'styles/globals.css',
    'tailwind.config.js',
    'tailwind.config.ts',
  ].filter(Boolean);
  if (sourceFile) {
    for (const root of roots) {
      const source = readOptional(path.join(root, sourceFile));
      for (const specifier of localImportSpecifiers(source)) {
        const base = path.join(path.dirname(sourceFile), specifier);
        for (const suffix of ['', '.js', '.jsx', '.ts', '.tsx', '.css', '/index.js', '/index.jsx', '/index.ts', '/index.tsx']) {
          const candidate = `${base}${suffix}`.split(path.sep).join('/');
          if (fs.existsSync(path.join(root, candidate))) {
            candidateNames.push(candidate);
            break;
          }
        }
      }
    }
  }
  for (const root of roots) {
    for (const name of candidateNames) {
      if (Object.hasOwn(result, name)) continue;
      const file = path.join(root, name);
      const body = readOptional(file);
      if (!body) continue;
      const bytes = Buffer.byteLength(body);
      if (totalBytes + bytes > maxBytes) continue;
      result[name] = body;
      totalBytes += bytes;
    }
  }
  return result;
}

function localImportSpecifiers(source) {
  if (!source) return [];
  const imports = [];
  const pattern = /(?:from\s*|import\s*)["'](\.{1,2}\/[^"']+)["']/g;
  let match;
  while ((match = pattern.exec(source))) imports.push(match[1]);
  return [...new Set(imports)];
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
