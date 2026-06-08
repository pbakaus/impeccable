import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = 'scripts/ci-test-plan.mjs';

describe('ci-test-plan', () => {
  it('keeps docs-only pull requests on the core suite', () => {
    const outputs = runPlan({
      GITHUB_EVENT_NAME: 'pull_request',
      CI_CHANGED_FILES: 'README.md',
    });

    assert.equal(outputs.core, 'true');
    assert.equal(outputs.detector, 'false');
    assert.equal(outputs.live, 'false');
    assert.equal(outputs.framework, 'false');
    assert.equal(outputs.live_e2e, 'false');
    assert.equal(outputs.live_e2e_accept_cleanup, 'false');
    assert.equal(outputs.live_svelte_adapter_deepseek, 'false');
  });

  it('routes detector changes to detector tests only', () => {
    const outputs = runPlan({
      GITHUB_EVENT_NAME: 'pull_request',
      CI_CHANGED_FILES: 'cli/engine/detect-antipatterns.mjs',
    });

    assert.equal(outputs.detector, 'true');
    assert.equal(outputs.live, 'false');
    assert.equal(outputs.framework, 'false');
  });

  it('routes live server changes to live unit and full live E2E lanes', () => {
    const outputs = runPlan({
      GITHUB_EVENT_NAME: 'pull_request',
      CI_CHANGED_FILES: 'skill/scripts/live-server.mjs',
    });

    assert.equal(outputs.live, 'true');
    assert.equal(outputs.live_e2e, 'true');
    assert.equal(outputs.live_e2e_accept_cleanup, 'true');
    assert.equal(outputs.live_svelte_adapter_deepseek, 'true');
    assert.equal(outputs.detector, 'false');
  });

  it('routes skill setup changes to the skill behavior lane', () => {
    const outputs = runPlan({
      GITHUB_EVENT_NAME: 'pull_request',
      CI_CHANGED_FILES: 'skill/SKILL.src.md',
    });

    assert.equal(outputs.skill_behavior, 'true');
    assert.equal(outputs.detector, 'false');
    assert.equal(outputs.live, 'false');
  });

  it('forces deterministic suites on push without forcing opt-in E2E suites', () => {
    const outputs = runPlan({
      GITHUB_EVENT_NAME: 'push',
      CI_CHANGED_FILES: 'README.md',
    });

    assert.equal(outputs.core, 'true');
    assert.equal(outputs.detector, 'true');
    assert.equal(outputs.live, 'true');
    assert.equal(outputs.framework, 'true');
    assert.equal(outputs.cli_remote_e2e, 'false');
    assert.equal(outputs.live_e2e, 'false');
    assert.equal(outputs.live_e2e_accept_cleanup, 'false');
    assert.equal(outputs.live_svelte_adapter_deepseek, 'false');
  });

  it('enables remote smoke suites on manual dispatch', () => {
    const outputs = runPlan({
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      CI_CHANGED_FILES: 'README.md',
    });

    assert.equal(outputs.cli_remote_e2e, 'true');
    assert.equal(outputs.live_e2e, 'true');
    assert.equal(outputs.live_e2e_accept_cleanup, 'true');
    assert.equal(outputs.skill_behavior, 'true');
    assert.equal(outputs.live_svelte_adapter_deepseek, 'true');
  });

  it('exposes planned opt-in suite outputs to workflow jobs', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf-8');

    assert.match(workflow, /live_e2e_accept_cleanup:\s*\$\{\{\s*steps\.plan\.outputs\.live_e2e_accept_cleanup\s*\}\}/);
    assert.match(workflow, /live_svelte_adapter_deepseek:\s*\$\{\{\s*steps\.plan\.outputs\.live_svelte_adapter_deepseek\s*\}\}/);
    assert.match(workflow, /live-e2e-accept-cleanup:/);
    assert.match(workflow, /live-svelte-adapter-deepseek:/);
  });
});

function runPlan(env) {
  const tmp = mkdtempSync(join(tmpdir(), 'impeccable-ci-plan-'));
  const outputPath = join(tmp, 'github-output');
  try {
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: process.cwd(),
      encoding: 'utf-8',
      env: {
        ...process.env,
        GITHUB_OUTPUT: outputPath,
        ...env,
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return Object.fromEntries(
      readFileSync(outputPath, 'utf-8')
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => line.split('=')),
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
