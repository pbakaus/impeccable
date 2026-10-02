import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SCRIPT = fileURLToPath(new URL('../skill/scripts/live-browser-session.js', import.meta.url));

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

function loadFactory() {
  const context = vm.createContext({});
  vm.runInContext(readFileSync(SCRIPT, 'utf-8'), context);
  return context.__IMPECCABLE_LIVE_SESSION__.createLiveBrowserSessionState;
}

describe('live-browser-session state helper', () => {
  it('issues a fresh checkpoint revision when storage is ahead of this instance', () => {
    const createState = loadFactory();
    const storage = createMemoryStorage();
    const first = createState({ prefix: 'impeccable-live', storage });
    const second = createState({ prefix: 'impeccable-live', storage });

    first.saveSession({ id: 'session-a' });
    assert.equal(first.nextCheckpointRevision(), 1);
    assert.equal(first.nextCheckpointRevision(), 2);

    assert.equal(second.nextCheckpointRevision(), 3);
    assert.equal(second.loadSession().checkpointRevision, 3);
  });

  it('keeps the stored checkpoint revision when an instance behind storage saves', () => {
    const createState = loadFactory();
    const storage = createMemoryStorage();
    const first = createState({ prefix: 'impeccable-live', storage });
    const second = createState({ prefix: 'impeccable-live', storage });

    first.saveSession({ id: 'session-a' });
    first.nextCheckpointRevision();
    first.nextCheckpointRevision();

    second.saveSession({ id: 'session-a' });
    assert.equal(second.loadSession().checkpointRevision, 2);
  });
});
