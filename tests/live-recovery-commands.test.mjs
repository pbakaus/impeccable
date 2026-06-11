import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createLiveSessionStore } from '../skill/scripts/live/session-store.mjs';

const REPO_ROOT = process.cwd();
const STATUS_SCRIPT = join(REPO_ROOT, 'skill/scripts/live-status.mjs');
const RESUME_SCRIPT = join(REPO_ROOT, 'skill/scripts/live-resume.mjs');
const COMPLETE_SCRIPT = join(REPO_ROOT, 'skill/scripts/live-complete.mjs');

function withTempProject(fn) {
  const cwd = mkdtempSync(join(tmpdir(), 'impeccable-live-recovery-'));
  try { return fn(cwd); }
  finally { rmSync(cwd, { recursive: true, force: true }); }
}

function runJson(script, args, cwd) {
  const out = execFileSync(process.execPath, [script, ...args], { cwd, encoding: 'utf-8' });
  return JSON.parse(out);
}

function setupMonorepoChildLiveSession(cwd, id = 'child-recover-1') {
  const repoRoot = realpathSync(cwd);
  writeFileSync(join(repoRoot, 'package.json'), JSON.stringify({
    private: true,
    workspaces: ['apps/*'],
  }));
  const childRoot = join(repoRoot, 'apps', 'dashboard');
  mkdirSync(join(childRoot, '.impeccable', 'live'), { recursive: true });
  writeFileSync(join(childRoot, '.impeccable', 'live', 'server.json'), JSON.stringify({
    pid: process.pid,
    port: 8401,
    token: 'child',
    projectRoot: childRoot,
    repoRoot,
  }));

  const store = createLiveSessionStore({ cwd: childRoot });
  store.appendEvent({
    type: 'generate',
    id,
    action: 'impeccable',
    count: 2,
    pageUrl: '/',
    element: { outerHTML: '<section>Dashboard</section>' },
  });
  return { childRoot, store };
}

describe('live recovery CLI commands', () => {
  it('prints active durable session status without a running helper server', () => withTempProject((cwd) => {
    const store = createLiveSessionStore({ cwd });
    store.appendEvent({ type: 'generate', id: 'cli-recover-1', action: 'impeccable', count: 3, pageUrl: '/', element: { outerHTML: '<button>Go</button>' } });

    const status = runJson(STATUS_SCRIPT, [], cwd);
    assert.equal(status.liveServer, null);
    assert.equal(status.activeSessions.length, 1);
    assert.equal(status.activeSessions[0].id, 'cli-recover-1');
    assert.match(status.recoveryHint, /Start live-server/);
  }));

  it('resumes the pending event and reports the next safe agent action', () => withTempProject((cwd) => {
    const store = createLiveSessionStore({ cwd });
    store.appendEvent({ type: 'generate', id: 'cli-recover-2', action: 'impeccable', count: 2, pageUrl: '/', element: { outerHTML: '<section>Hero</section>' } });

    const resume = runJson(RESUME_SCRIPT, ['--id', 'cli-recover-2'], cwd);
    assert.equal(resume.active, true);
    assert.equal(resume.pendingEvent.type, 'generate');
    assert.match(
      resume.nextAction,
      /live-poll\.mjs/,
      'event=live_resume.next_action actor=agent operation=recover_session risk=agent_has_state_but_no_next_step expected=live-poll.mjs actual=' + resume.nextAction,
    );
  }));

  it('resumes manual Apply with the structured reply action, not a plain ack', () => withTempProject((cwd) => {
    const store = createLiveSessionStore({ cwd });
    store.appendEvent({
      type: 'manual_edit_apply',
      id: 'manual-recover-1',
      pageUrl: '/',
      chunk: { index: 3, total: 3, opCount: 2, totalOpCount: 8 },
      batch: {
        entries: [{
          id: 'entry-a',
          ops: [{
            ref: 'body>p:nth-of-type(1)',
            originalText: 'Old',
            newText: 'New',
            sourceHint: { file: 'src/App.jsx', line: 12 },
          }],
        }],
        candidates: [],
      },
    });

    const resume = runJson(RESUME_SCRIPT, ['--id', 'manual-recover-1'], cwd);
    assert.equal(resume.active, true);
    assert.equal(resume.pendingEvent.type, 'manual_edit_apply');
    assert.equal(resume.snapshot.phase, 'manual_edit_apply_requested');
    assert.match(resume.nextAction, /--reply manual-recover-1 done --data '<json>'/);
    assert.match(resume.nextAction, /Polling only leases this work item; it does not commit source edits/);
    assert.match(resume.nextAction, /Do not run live-commit-manual-edits\.mjs/);
    assert.match(resume.nextAction, /chunk 3\/3/);
    assert.match(resume.nextAction, /likely files: src\/App\.jsx/);
    assert.doesNotMatch(resume.nextAction, /acknowledge with live-poll\.mjs --reply manual-recover-1 done\./);

    const status = runJson(STATUS_SCRIPT, [], cwd);
    assert.match(status.recoveryHint, /--reply manual-recover-1 done --data '<json>'/);
    assert.match(status.recoveryHint, /Do not poll again before replying/);
  }));

  it('resumes carbonize-required sessions with a cleanup-specific next action', () => withTempProject((cwd) => {
    const store = createLiveSessionStore({ cwd });
    store.appendEvent({ type: 'accept', id: 'cli-carbonize-1', variantId: '1' });
    store.appendEvent({ type: 'agent_done', id: 'cli-carbonize-1', file: 'src/App.jsx', carbonize: true });

    const resume = runJson(RESUME_SCRIPT, ['--id', 'cli-carbonize-1'], cwd);
    assert.equal(resume.active, true);
    assert.equal(resume.snapshot.phase, 'carbonize_required');
    assert.match(
      resume.nextAction,
      /Finish carbonize cleanup in src\/App\.jsx/,
      'event=live_resume.carbonize_next_action actor=agent operation=recover_carbonize risk=carbonize_cleanup_hidden_after_accept expected=cleanup-specific action actual=' + resume.nextAction,
    );
  }));

  it('resumes the single discovered child live server from a monorepo root', () => withTempProject((cwd) => {
    setupMonorepoChildLiveSession(cwd, 'child-recover-1');

    const resume = runJson(RESUME_SCRIPT, ['--id', 'child-recover-1'], cwd);
    assert.equal(resume.active, true);
    assert.equal(resume.snapshot.id, 'child-recover-1');
    assert.match(resume.nextAction, /child-recover-1/);
  }));

  it('reads status from the single discovered child live server sessions', () => withTempProject((cwd) => {
    setupMonorepoChildLiveSession(cwd, 'child-status-1');

    const status = runJson(STATUS_SCRIPT, [], cwd);
    assert.equal(status.liveServer, null);
    assert.equal(status.activeSessions.length, 1);
    assert.equal(status.activeSessions[0].id, 'child-status-1');
  }));

  it('completes the single discovered child live server session from a monorepo root', () => withTempProject((cwd) => {
    const { childRoot } = setupMonorepoChildLiveSession(cwd, 'child-complete-1');

    const completed = runJson(COMPLETE_SCRIPT, ['--id', 'child-complete-1'], cwd);
    assert.equal(completed.ok, true);
    assert.equal(completed.phase, 'completed');

    const childStore = createLiveSessionStore({ cwd: childRoot, sessionId: 'child-complete-1' });
    assert.equal(childStore.getSnapshot('child-complete-1', { includeCompleted: true }).phase, 'completed');

    const rootStore = createLiveSessionStore({ cwd, sessionId: 'child-complete-1' });
    assert.deepEqual(rootStore.listActiveSessions(), []);
  }));

  it('marks a session completed through the canonical completion command', () => withTempProject((cwd) => {
    const store = createLiveSessionStore({ cwd });
    store.appendEvent({ type: 'generate', id: 'cli-recover-3', action: 'impeccable', count: 1, pageUrl: '/', element: { outerHTML: '<p>Copy</p>' } });

    const completed = runJson(COMPLETE_SCRIPT, ['--id', 'cli-recover-3'], cwd);
    assert.equal(completed.ok, true);
    assert.equal(completed.phase, 'completed');

    const status = runJson(STATUS_SCRIPT, [], cwd);
    assert.deepEqual(status.activeSessions, []);
  }));
});
