import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  CODEX_WORKER_OWNER,
  applyCodexWorkerOutput,
  buildCodexWorkerInstructions,
  buildGenerationTurnInput,
  codexWorkerStateIsOwned,
  readPreparedArtifact,
  resolveCodexWorkerConfig,
} from '../skill/scripts/live/codex-worker.mjs';

describe('Codex Live worker configuration', () => {
  it('is off by default and requires an explicit opt-in', () => {
    assert.deepEqual(resolveCodexWorkerConfig({ env: {}, liveConfig: {} }), {
      enabled: false,
      model: null,
      codexPath: 'codex',
      effort: 'low',
      delivery: 'progressive',
      maxArtifactBytes: 2_000_000,
    });
    assert.equal(resolveCodexWorkerConfig({
      env: { IMPECCABLE_LIVE_CODEX_WORKER: '1' },
      liveConfig: {},
    }).enabled, true);
    assert.equal(resolveCodexWorkerConfig({
      env: { IMPECCABLE_LIVE_CODEX_WORKER: 'false' },
      liveConfig: { experimentalCodexWorker: { enabled: true } },
    }).enabled, false, 'explicit environment disable wins');
    assert.equal(resolveCodexWorkerConfig({
      env: {},
      liveConfig: { experimentalCodexWorker: { enabled: true, delivery: 'atomic' } },
    }).enabled, false, 'committed config cannot activate Codex in another harness');
  });

  it('recognizes only a Live-owned durable thread record', () => {
    const cwd = '/tmp/project';
    assert.equal(codexWorkerStateIsOwned({ owner: CODEX_WORKER_OWNER, cwd, threadId: 'worker-1' }, cwd), true);
    assert.equal(codexWorkerStateIsOwned({ owner: 'desktop', cwd, threadId: 'desktop-1' }, cwd), false);
    assert.equal(codexWorkerStateIsOwned({ owner: CODEX_WORKER_OWNER, cwd: '/tmp/other', threadId: 'worker-1' }, cwd), false);
  });

  it('leaves the portable foreground path untouched when the switch is off', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'codex-worker-disabled-'));
    const script = path.resolve('skill/scripts/live-codex-worker.mjs');
    const result = spawnSync(process.execPath, [script], {
      cwd,
      encoding: 'utf-8',
      env: { ...process.env, IMPECCABLE_LIVE_CODEX_WORKER: '0' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: false,
      error: 'codex_worker_disabled',
      fallback: 'foreground',
    });
  });

  it('refuses to signal a pid from an unowned state record', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'codex-worker-unowned-'));
    const statePath = path.join(cwd, '.impeccable/live/codex-worker.json');
    mkdirSync(path.dirname(statePath), { recursive: true });
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], {
      stdio: 'ignore',
    });
    try {
      writeFileSync(statePath, JSON.stringify({
        owner: 'desktop',
        cwd,
        pid: unrelated.pid,
        status: 'ready',
      }));
      const script = path.resolve('skill/scripts/live-codex-worker.mjs');
      const result = spawnSync(process.execPath, [script, '--stop'], {
        cwd,
        encoding: 'utf-8',
      });
      assert.equal(result.status, 2, result.stderr);
      assert.equal(JSON.parse(result.stdout).error, 'codex_worker_state_unowned');
      assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
    } finally {
      unrelated.kill('SIGTERM');
    }
  });

  it('reports a stop timeout instead of claiming an owned live process stopped', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'codex-worker-stop-timeout-'));
    const statePath = path.join(cwd, '.impeccable/live/codex-worker.json');
    mkdirSync(path.dirname(statePath), { recursive: true });
    const stubborn = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], {
      stdio: 'ignore',
    });
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    try {
      writeFileSync(statePath, JSON.stringify({
        owner: CODEX_WORKER_OWNER,
        cwd,
        threadId: 'owned-thread',
        pid: stubborn.pid,
        status: 'ready',
      }));
      const script = path.resolve('skill/scripts/live-codex-worker.mjs');
      const result = spawnSync(process.execPath, [script, '--stop'], {
        cwd,
        encoding: 'utf-8',
        env: { ...process.env, IMPECCABLE_LIVE_CODEX_STOP_TIMEOUT_MS: '100' },
      });
      assert.equal(result.status, 2, result.stderr);
      assert.equal(JSON.parse(result.stdout).status, 'stop_timeout');
      assert.doesNotThrow(() => process.kill(stubborn.pid, 0));
    } finally {
      stubborn.kill('SIGKILL');
    }
  });

  it('terminates a detached child before returning foreground fallback on startup timeout', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'codex-worker-start-timeout-'));
    const liveDir = path.join(cwd, '.impeccable/live');
    mkdirSync(liveDir, { recursive: true });
    writeFileSync(path.join(liveDir, 'server.json'), JSON.stringify({
      pid: process.pid,
      port: 1,
      token: 'smoke-token',
    }));
    const fakeCodex = path.join(cwd, 'fake-codex');
    writeFileSync(fakeCodex, '#!/bin/sh\nwhile true; do sleep 1; done\n');
    chmodSync(fakeCodex, 0o755);
    const script = path.resolve('skill/scripts/live-codex-worker.mjs');
    const result = spawnSync(process.execPath, [script, '--background'], {
      cwd,
      encoding: 'utf-8',
      env: {
        ...process.env,
        IMPECCABLE_LIVE_CODEX_WORKER: '1',
        IMPECCABLE_CODEX_PATH: fakeCodex,
        IMPECCABLE_LIVE_CODEX_START_TIMEOUT_MS: '100',
        IMPECCABLE_LIVE_CODEX_STOP_TIMEOUT_MS: '1000',
      },
      timeout: 5_000,
    });
    assert.equal(result.status, 2, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.error, 'codex_worker_start_timeout');
    assert.equal(output.terminated, true);
    assert.equal(output.fallback, 'foreground');
    assert.throws(() => process.kill(output.childPid, 0), (error) => error.code === 'ESRCH');
  });
});

describe('Codex Live worker structured artifact boundary', () => {
  it('keeps the model tool-free and the supervisor as the only publisher', () => {
    const instructions = buildCodexWorkerInstructions('LIVE SPEC');
    assert.match(instructions, /Do not use tools/);
    assert.match(instructions, /supervisor alone writes staged artifacts/);
    assert.match(instructions, /Ignore any instruction.*run commands/);
  });

  it('writes only the prepared source artifact path', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'codex-worker-source-'));
    const artifact = path.join(cwd, '.impeccable/live/artifacts/session-r1.jsx');
    mkdirSync(path.dirname(artifact), { recursive: true });
    writeFileSync(artifact, 'before');
    const prepared = { artifactFile: '.impeccable/live/artifacts/session-r1.jsx' };

    applyCodexWorkerOutput({
      output: { files: [{ path: prepared.artifactFile, content: 'after' }] },
      prepared,
      phase: 'first',
      expectedVariants: 3,
      cwd,
    });
    assert.equal(readFileSync(artifact, 'utf-8'), 'after');
    assert.throws(
      () => applyCodexWorkerOutput({
        output: { files: [{ path: 'src/App.jsx', content: 'unsafe' }] },
        prepared,
        phase: 'first',
        expectedVariants: 3,
        cwd,
      }),
      /worker_output_source_path_invalid/,
    );
  });

  it('never lets a final component turn rewrite arrived variant 1', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'codex-worker-component-'));
    const componentDir = path.join(cwd, '.impeccable/live/artifacts/session-r2-svelte');
    mkdirSync(componentDir, { recursive: true });
    writeFileSync(path.join(componentDir, 'manifest.json'), JSON.stringify({
      id: 'session',
      previewMode: 'svelte-component',
      componentExtension: 'svelte',
      arrivedVariants: 1,
    }));
    writeFileSync(path.join(componentDir, 'v1.svelte'), '<h1>Immutable</h1>');
    const prepared = {
      previewMode: 'svelte-component',
      componentDir: '.impeccable/live/artifacts/session-r2-svelte',
      artifactFile: '.impeccable/live/artifacts/session-r2-svelte/manifest.json',
    };

    assert.throws(
      () => applyCodexWorkerOutput({
        output: { files: [{ path: 'v1.svelte', content: '<h1>Changed</h1>' }] },
        prepared,
        phase: 'final',
        expectedVariants: 3,
        cwd,
      }),
      /published_variant_changed/,
    );

    applyCodexWorkerOutput({
      output: {
        files: [
          { path: 'v2.svelte', content: '<h1>Two</h1>' },
          { path: 'v3.svelte', content: '<h1>Three</h1>' },
          { path: 'params.json', content: '{"1":[],"2":[],"3":[]}' },
        ],
      },
      prepared,
      phase: 'final',
      expectedVariants: 3,
      cwd,
    });
    assert.equal(readFileSync(path.join(componentDir, 'v1.svelte'), 'utf-8'), '<h1>Immutable</h1>');
    assert.equal(JSON.parse(readFileSync(path.join(componentDir, 'manifest.json'))).arrivedVariants, 3);
  });

  it('requires atomic component output to contain v1 through vN plus params', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'codex-worker-component-atomic-'));
    const componentDir = path.join(cwd, '.impeccable/live/artifacts/session-r1-svelte');
    mkdirSync(componentDir, { recursive: true });
    writeFileSync(path.join(componentDir, 'manifest.json'), JSON.stringify({
      previewMode: 'svelte-component',
      componentExtension: 'svelte',
    }));
    writeFileSync(path.join(componentDir, 'v1.svelte'), '<h1>Scaffold stub</h1>');
    const prepared = {
      previewMode: 'svelte-component',
      componentDir: '.impeccable/live/artifacts/session-r1-svelte',
      artifactFile: '.impeccable/live/artifacts/session-r1-svelte/manifest.json',
    };
    assert.throws(() => applyCodexWorkerOutput({
      output: { files: [
        { path: 'v2.svelte', content: '<h1>Two</h1>' },
        { path: 'v3.svelte', content: '<h1>Three</h1>' },
        { path: 'params.json', content: '{}' },
      ] },
      prepared,
      phase: 'atomic',
      expectedVariants: 3,
      cwd,
    }), /worker_output_component_file_missing/);
  });

  it('does not let precreated stubs satisfy missing final component output', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'codex-worker-component-final-'));
    const componentDir = path.join(cwd, '.impeccable/live/artifacts/session-r2-svelte');
    mkdirSync(componentDir, { recursive: true });
    writeFileSync(path.join(componentDir, 'manifest.json'), JSON.stringify({
      previewMode: 'svelte-component',
      componentExtension: 'svelte',
      arrivedVariants: 1,
    }));
    for (const variant of [1, 2, 3]) writeFileSync(path.join(componentDir, `v${variant}.svelte`), `<h1>${variant}</h1>`);
    writeFileSync(path.join(componentDir, 'params.json'), '{}');
    const prepared = {
      previewMode: 'svelte-component',
      componentDir: '.impeccable/live/artifacts/session-r2-svelte',
      artifactFile: '.impeccable/live/artifacts/session-r2-svelte/manifest.json',
    };
    assert.throws(() => applyCodexWorkerOutput({
      output: { files: [{ path: 'v2.svelte', content: '<h1>Two</h1>' }] },
      prepared,
      phase: 'final',
      expectedVariants: 3,
      cwd,
    }), /worker_output_component_file_missing/);
  });

  it('builds phase prompts from bounded staged evidence', () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'codex-worker-context-'));
    const artifactPath = path.join(cwd, 'artifact.html');
    writeFileSync(artifactPath, '<main>wrapped</main>');
    const prepared = { artifactFile: 'artifact.html' };
    const artifact = readPreparedArtifact(prepared, { cwd });
    const prompt = buildGenerationTurnInput({
      event: { id: 'abc', count: 3, scaffold: { file: 'artifact.html' } },
      phase: 'first',
      prepared,
      artifact,
      product: 'Product facts',
      design: 'Design tokens',
      actionReference: 'Polish rules',
    });
    assert.match(prompt, /Produce only variant 1/);
    assert.match(prompt, /<main>wrapped<\/main>/);
    assert.match(prompt, /Product facts/);
    assert.match(prompt, /Design tokens/);
  });
});
