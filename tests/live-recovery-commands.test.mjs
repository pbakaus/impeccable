import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createLiveSessionStore } from '../source/skills/impeccable/scripts/live-session-store.mjs';

const REPO_ROOT = process.cwd();
const STATUS_SCRIPT = join(REPO_ROOT, 'source/skills/impeccable/scripts/live-status.mjs');
const RESUME_SCRIPT = join(REPO_ROOT, 'source/skills/impeccable/scripts/live-resume.mjs');
const COMPLETE_SCRIPT = join(REPO_ROOT, 'source/skills/impeccable/scripts/live-complete.mjs');

function withTempProject(fn) {
  const cwd = mkdtempSync(join(tmpdir(), 'impeccable-live-recovery-'));
  try { return fn(cwd); }
  finally { rmSync(cwd, { recursive: true, force: true }); }
}

function runJson(script, args, cwd) {
  const out = execFileSync(process.execPath, [script, ...args], { cwd, encoding: 'utf-8' });
  return JSON.parse(out);
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
