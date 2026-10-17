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

function loadSession(globals = {}) {
  const context = vm.createContext(globals);
  vm.runInContext(readFileSync(SCRIPT, 'utf-8'), context);
  return context.__IMPECCABLE_LIVE_SESSION__;
}

function loadFactory() {
  return loadSession().createLiveBrowserSessionState;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

  // Issue #1055: plain-HTTP origins that are not localhost (LAN IP, Tailscale,
  // custom hostname) are not secure contexts, so crypto.randomUUID is absent.
  it('creates session state on an insecure origin where crypto.randomUUID is missing', () => {
    let calls = 0;
    const insecureCrypto = {
      getRandomValues(bytes) { calls += 1; for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) & 0xff; return bytes; },
    };
    const session = loadSession({ crypto: insecureCrypto });
    const state = session.createLiveBrowserSessionState({ prefix: 'impeccable-live', storage: createMemoryStorage() });
    assert.match(state.owner, /^[0-9a-f]{8}$/);
    assert.ok(calls > 0, 'getRandomValues backs the id when randomUUID is missing');
    assert.match(session.randomUUID(), UUID_V4);
  });

  it('builds a v4 UUID from Math.random when there is no crypto at all', () => {
    const session = loadSession({});
    assert.match(session.randomUUID(null), UUID_V4);
    assert.match(session.randomId8(null), /^[0-9a-f]{8}$/);
    const state = session.createLiveBrowserSessionState({ prefix: 'impeccable-live', storage: createMemoryStorage() });
    assert.match(state.owner, /^[0-9a-f]{8}$/);
  });

  it('prefers crypto.randomUUID where the context provides it', () => {
    const session = loadSession({ crypto: { randomUUID: () => 'abcdef01-2345-4678-9abc-def012345678' } });
    assert.equal(session.randomId8(), 'abcdef01');
  });

  it('falls through when randomUUID throws', () => {
    const session = loadSession({ crypto: { randomUUID() { throw new TypeError('not allowed'); } } });
    assert.match(session.randomUUID(), UUID_V4);
  });
});
