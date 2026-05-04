/**
 * Tests for durable live-session state.
 * Run with: node --test tests/live-session-store.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createLiveSessionStore } from '../source/skills/impeccable/scripts/live-session-store.mjs';
import {
  getLegacyLiveSessionsDir,
  getLiveAnnotationsDir,
  getLiveSessionsDir,
} from '../source/skills/impeccable/scripts/impeccable-paths.mjs';

describe('live-session-store', () => {
  let tmp;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'impeccable-session-store-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('rebuilds an active snapshot from an append-only journal after process restart', () => {
    const store = createLiveSessionStore({ cwd: tmp, sessionId: 'session-a' });
    store.appendEvent({
      type: 'generate',
      id: 'session-a',
      action: 'polish',
      count: 3,
      pageUrl: 'http://localhost:4321/',
      element: { outerHTML: '<section class="hero">Hero</section>', tagName: 'section' },
      screenshotPath: join(getLiveAnnotationsDir(tmp), 'session-a.png'),
    });
    store.appendEvent({ type: 'variants_ready', id: 'session-a', file: 'src/pages/index.astro', arrivedVariants: 3 });
    store.appendEvent({ type: 'accept_intent', id: 'session-a', variantId: 2, paramValues: { density: 'packed' } });

    const restarted = createLiveSessionStore({ cwd: tmp, sessionId: 'session-a' });
    const snapshot = restarted.getSnapshot('session-a');

    assert.equal(snapshot.id, 'session-a');
    assert.equal(snapshot.phase, 'accept_requested');
    assert.equal(snapshot.expectedVariants, 3);
    assert.equal(snapshot.arrivedVariants, 3);
    assert.equal(snapshot.sourceFile, 'src/pages/index.astro');
    assert.equal(snapshot.visibleVariant, 2);
    assert.deepEqual(snapshot.paramValues, { density: 'packed' });
    assert.equal(snapshot.annotationArtifacts[0].path.endsWith('session-a.png'), true);

    const active = restarted.listActiveSessions();
    assert.equal(
      active.length,
      1,
      'event=live_session_store.active_restart actor=agent operation=list_active_sessions risk=server_restart_loses_live_state expected=one active session actual=' + active.length + ' suggestion=inspect journal replay and completed phase filtering',
    );
    assert.equal(active[0].id, 'session-a');
  });

  it('reports corrupted journal lines while preserving valid prior events', () => {
    const store = createLiveSessionStore({ cwd: tmp, sessionId: 'corrupt-session' });
    store.appendEvent({
      type: 'generate',
      id: 'corrupt-session',
      action: 'layout',
      count: 2,
      element: { outerHTML: '<div>Card</div>', tagName: 'div' },
    });

    appendFileSync(join(getLiveSessionsDir(tmp), 'corrupt-session.jsonl'), '{not json}\n');

    const restarted = createLiveSessionStore({ cwd: tmp, sessionId: 'corrupt-session' });
    const snapshot = restarted.getSnapshot('corrupt-session');

    assert.equal(snapshot.phase, 'generate_requested');
    assert.equal(snapshot.expectedVariants, 2);
    assert.equal(snapshot.diagnostics.length, 1);
    assert.match(snapshot.diagnostics[0].error, /journal_parse_failed/);
  });

  it('does not duplicate parse diagnostics when valid entries follow a corrupted journal line', () => {
    const dir = getLiveSessionsDir(tmp);
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'corrupt-then-valid.jsonl'), '{not json}\n');
    appendFileSync(join(dir, 'corrupt-then-valid.jsonl'), JSON.stringify({
      seq: 1,
      id: 'corrupt-then-valid',
      type: 'generate',
      ts: new Date().toISOString(),
      event: {
        type: 'generate',
        id: 'corrupt-then-valid',
        action: 'polish',
        count: 2,
        element: { outerHTML: '<h1>Title</h1>', tagName: 'h1' },
      },
    }) + '\n');

    const store = createLiveSessionStore({ cwd: tmp, sessionId: 'corrupt-then-valid' });
    const snapshot = store.getSnapshot('corrupt-then-valid');
    const parseDiagnostics = snapshot.diagnostics.filter((d) => d.error === 'journal_parse_failed');

    assert.equal(snapshot.phase, 'generate_requested');
    assert.equal(
      parseDiagnostics.length,
      1,
      'event=live_session_store.duplicate_parse_diagnostic actor=store operation=journal_replay risk=duplicate_status_noise expected=1 actual=' + parseDiagnostics.length,
    );
  });

  it('preserves zero-valued checkpoint revisions and empty explicit fields', () => {
    const store = createLiveSessionStore({ cwd: tmp, sessionId: 'zero-checkpoint' });
    store.appendEvent({
      type: 'checkpoint',
      id: 'zero-checkpoint',
      revision: 0,
      phase: '',
      owner: '',
      arrivedVariants: 0,
      visibleVariant: 0,
      paramValues: { density: 0 },
    });

    const snapshot = store.getSnapshot('zero-checkpoint');
    assert.equal(
      snapshot.checkpointRevision,
      0,
      'event=live_session_store.zero_checkpoint_revision actor=browser operation=checkpoint_replay risk=zero_revision_dropped expected=0 actual=' + snapshot.checkpointRevision,
    );
    assert.equal(snapshot.phase, '');
    assert.equal(snapshot.activeOwner, '');
    assert.equal(snapshot.visibleVariant, 0);
    assert.deepEqual(snapshot.paramValues, { density: 0 });
  });

  it('ignores stale checkpoints and keeps the newest browser state', () => {
    const store = createLiveSessionStore({ cwd: tmp, sessionId: 'checkpoint-session' });
    store.appendEvent({
      type: 'generate',
      id: 'checkpoint-session',
      action: 'layout',
      count: 3,
      element: { outerHTML: '<section>Hero</section>', tagName: 'section' },
    });
    store.appendEvent({ type: 'checkpoint', id: 'checkpoint-session', revision: 5, phase: 'cycling', visibleVariant: 3, paramValues: { density: 'packed' } });
    store.appendEvent({ type: 'checkpoint', id: 'checkpoint-session', revision: 2, phase: 'cycling', visibleVariant: 1, paramValues: { density: 'airy' } });

    const snapshot = store.getSnapshot('checkpoint-session');
    assert.equal(snapshot.checkpointRevision, 5);
    assert.equal(snapshot.visibleVariant, 3);
    assert.deepEqual(snapshot.paramValues, { density: 'packed' });
    assert.equal(
      snapshot.diagnostics.some((d) => d.error === 'stale_checkpoint_ignored' && d.revision === 2),
      true,
      'event=live_session_store.stale_checkpoint actor=browser operation=checkpoint_replay risk=old_browser_state_overwrites_newer_choice expected=stale diagnostic actual=' + JSON.stringify(snapshot.diagnostics),
    );
  });

  it('keeps carbonize-required accepted sessions active until explicit completion', () => {
    const store = createLiveSessionStore({ cwd: tmp, sessionId: 'carbonize-session' });
    store.appendEvent({
      type: 'accept',
      id: 'carbonize-session',
      variantId: '2',
      paramValues: { tone: 'sharp' },
    });
    store.appendEvent({ type: 'agent_done', id: 'carbonize-session', file: 'src/App.jsx', carbonize: true });

    const snapshot = store.getSnapshot('carbonize-session');
    assert.equal(
      snapshot.phase,
      'carbonize_required',
      'event=live_session_store.carbonize_required actor=agent operation=accept_ack risk=carbonize_session_hidden_from_recovery expected=carbonize_required actual=' + snapshot.phase,
    );
    assert.equal(snapshot.sourceFile, 'src/App.jsx');
    assert.equal(snapshot.pendingEvent, null);
    assert.equal(store.listActiveSessions().some((s) => s.id === 'carbonize-session'), true);

    store.appendEvent({ type: 'complete', id: 'carbonize-session' });
    const completed = store.getSnapshot('carbonize-session', { includeCompleted: true });
    assert.equal(completed.phase, 'completed');
    assert.equal(store.listActiveSessions().some((s) => s.id === 'carbonize-session'), false);
  });

  it('clears pending events when an agent error is acknowledged', () => {
    const store = createLiveSessionStore({ cwd: tmp, sessionId: 'error-session' });
    store.appendEvent({
      type: 'generate',
      id: 'error-session',
      action: 'polish',
      count: 1,
      element: { outerHTML: '<button>Try</button>', tagName: 'button' },
    });
    store.appendEvent({ type: 'agent_error', id: 'error-session', message: 'accept failed' });

    const snapshot = store.getSnapshot('error-session');
    assert.equal(snapshot.phase, 'agent_error');
    assert.equal(snapshot.pendingEvent, null);
    assert.equal(snapshot.pendingEventSeq, null);
    assert.equal(
      store.listActiveSessions()[0].pendingEvent,
      null,
      'event=live_session_store.agent_error_ack actor=agent operation=restart_replay risk=acknowledged_error_event_redelivered expected=null actual=' + JSON.stringify(store.listActiveSessions()[0].pendingEvent),
    );
  });

  it('keeps completed sessions auditable but excludes them from active sessions by default', () => {
    const store = createLiveSessionStore({ cwd: tmp, sessionId: 'done-session' });
    store.appendEvent({
      type: 'generate',
      id: 'done-session',
      action: 'bolder',
      count: 1,
      element: { outerHTML: '<h1>Title</h1>', tagName: 'h1' },
    });
    store.appendEvent({ type: 'agent_done', id: 'done-session', file: 'src/pages/index.astro' });
    store.appendEvent({ type: 'complete', id: 'done-session' });

    const active = store.listActiveSessions();
    const completed = store.getSnapshot('done-session', { includeCompleted: true });

    assert.equal(active.length, 0);
    assert.equal(completed.phase, 'completed');
    assert.equal(completed.sourceFile, 'src/pages/index.astro');
  });

  it('writes a rebuildable snapshot cache without making it authoritative', () => {
    const store = createLiveSessionStore({ cwd: tmp, sessionId: 'cache-session' });
    store.appendEvent({
      type: 'generate',
      id: 'cache-session',
      action: 'colorize',
      count: 2,
      element: { outerHTML: '<div>Palette</div>', tagName: 'div' },
    });

    const snapshotPath = join(getLiveSessionsDir(tmp), 'cache-session.snapshot.json');
    const cached = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
    assert.equal(cached.phase, 'generate_requested');

    // Simulate stale snapshot cache. Restart must prefer journal truth and repair cache.
    appendFileSync(snapshotPath, '');
    const restarted = createLiveSessionStore({ cwd: tmp, sessionId: 'cache-session' });
    restarted.appendEvent({ type: 'agent_done', id: 'cache-session', file: 'src/pages/index.astro' });
    const repaired = JSON.parse(readFileSync(snapshotPath, 'utf-8'));

    assert.equal(repaired.phase, 'variants_ready');
    assert.equal(repaired.sourceFile, 'src/pages/index.astro');
  });

  it('recovers legacy journals from .impeccable-live/sessions', () => {
    const legacyDir = getLegacyLiveSessionsDir(tmp);
    mkdirSync(legacyDir, { recursive: true });
    appendFileSync(join(legacyDir, 'legacy-session.jsonl'), JSON.stringify({
      seq: 1,
      id: 'legacy-session',
      type: 'generate',
      ts: new Date().toISOString(),
      event: {
        type: 'generate',
        id: 'legacy-session',
        action: 'polish',
        count: 2,
        element: { outerHTML: '<section>Legacy</section>', tagName: 'section' },
      },
    }) + '\n');

    const store = createLiveSessionStore({ cwd: tmp, sessionId: 'legacy-session' });
    const snapshot = store.getSnapshot('legacy-session');

    assert.equal(snapshot.phase, 'generate_requested');
    assert.equal(snapshot.expectedVariants, 2);
    assert.equal(store.listActiveSessions().some((s) => s.id === 'legacy-session'), true);

    store.appendEvent({ type: 'agent_done', id: 'legacy-session', file: 'src/App.jsx' });
    const restarted = createLiveSessionStore({ cwd: tmp, sessionId: 'legacy-session' });
    const migratedSnapshot = restarted.getSnapshot('legacy-session');
    assert.equal(migratedSnapshot.phase, 'variants_ready');
    assert.equal(migratedSnapshot.expectedVariants, 2);
    assert.equal(migratedSnapshot.sourceFile, 'src/App.jsx');
  });
});
