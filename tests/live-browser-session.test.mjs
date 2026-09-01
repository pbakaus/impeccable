import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const REPO_ROOT = process.cwd();
const SCRIPT = join(REPO_ROOT, 'skill/scripts/live-browser-session.js');

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function loadFactory() {
  const context = { window: {}, globalThis: {}, console };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(readFileSync(SCRIPT, 'utf-8'), context, { filename: SCRIPT });
  return context.__IMPECCABLE_LIVE_SESSION__.createLiveBrowserSessionState;
}

describe('live-browser-session state helper', () => {
  it('persists session, handled state, and scroll independently', () => {
    const createState = loadFactory();
    const storage = createMemoryStorage();
    const state = createState({ prefix: 'impeccable-live', storage, idFactory: () => 'owner-a' });

    state.writeScrollY(420);
    state.saveSession({ id: 'session-a', state: 'CYCLING', visible: 2 });
    state.markHandled('session-a');

    assert.equal(state.readScrollY(), 420);
    assert.equal(state.loadSession().visible, 2);
    assert.equal(state.isHandled('session-a'), true);

    state.clearSession();
    assert.equal(state.loadSession(), null);
    assert.equal(state.readScrollY(), 420, 'scroll key is deliberately independent from session key');
  });

  it('carries checkpoint revision across reload-equivalent helper instances', () => {
    const createState = loadFactory();
    const storage = createMemoryStorage();
    const first = createState({ prefix: 'impeccable-live', storage, idFactory: () => 'owner-a' });
    first.saveSession({ id: 'session-b', state: 'CYCLING', visible: 1 });
    assert.equal(first.nextCheckpointRevision(), 1);
    assert.equal(first.nextCheckpointRevision(), 2);

    const second = createState({ prefix: 'impeccable-live', storage, idFactory: () => 'owner-b' });
    const restored = second.loadSession();
    assert.equal(restored.checkpointRevision, 2);
    assert.equal(
      second.nextCheckpointRevision(),
      3,
      'event=live_browser_session.revision_resume actor=browser operation=reload_checkpoint risk=durable_store_ignores_stale_checkpoint expected=3 actual=' + second.currentCheckpointRevision(),
    );
  });

  it('retains overlapping handled sessions and reads the legacy single-id format', () => {
    const createState = loadFactory();
    const storage = createMemoryStorage();
    const first = createState({ prefix: 'impeccable-live', storage, idFactory: () => 'owner-a' });

    first.markHandled('session-a');
    first.markHandled('session-b');
    assert.equal(first.isHandled('session-a'), true);
    assert.equal(first.isHandled('session-b'), true);

    const second = createState({ prefix: 'impeccable-live', storage, idFactory: () => 'owner-b' });
    assert.equal(second.isHandled('session-a'), true, 'handled sessions survive reload-equivalent helpers');
    second.clearHandled('session-a');
    assert.equal(second.isHandled('session-a'), false);
    assert.equal(second.isHandled('session-b'), true, 'clearing one recovery must preserve overlapping sessions');

    storage.setItem(second.handledKey, 'legacy-session');
    assert.equal(second.isHandled('legacy-session'), true);
  });
});
