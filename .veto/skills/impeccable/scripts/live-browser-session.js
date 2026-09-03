/**
 * Browser-side durable session helpers for Impeccable live mode.
 *
 * Kept separate from live-browser.js so recovery state can be tested without
 * booting the full overlay UI. Served before live-browser.js and attached to
 * window.__IMPECCABLE_LIVE_SESSION__.
 */
(function (root) {
  'use strict';

  function createLiveBrowserSessionState({ prefix, storage, idFactory }) {
    if (!prefix) throw new Error('prefix required');
    const store = storage || root.localStorage;
    const makeId = idFactory || function () { return Math.random().toString(16).slice(2, 10); };
    const sessionKey = prefix + '-session';
    const handledKey = sessionKey + '-handled';
    const scrollKey = sessionKey + '-scroll';
    let checkpointRevision = 0;
    const owner = makeId();

    function safeRead(key) {
      try { return store.getItem(key); } catch { return null; }
    }

    function safeWrite(key, value) {
      try { store.setItem(key, value); } catch { /* quota exceeded or private mode */ }
    }

    function safeRemove(key) {
      try { store.removeItem(key); } catch { /* unavailable storage */ }
    }

    function loadSession() {
      try {
        const raw = safeRead(sessionKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (Number.isInteger(parsed.checkpointRevision)) {
          checkpointRevision = Math.max(checkpointRevision, parsed.checkpointRevision);
        }
        return parsed;
      } catch { return null; }
    }

    function saveSession(session) {
      if (!session || !session.id) return;
      const payload = {
        ...session,
        checkpointRevision,
      };
      safeWrite(sessionKey, JSON.stringify(payload));
    }

    function clearSession() {
      safeRemove(sessionKey);
    }

    function nextCheckpointRevision() {
      checkpointRevision += 1;
      const existing = loadSession();
      if (existing?.id) saveSession(existing);
      return checkpointRevision;
    }

    function seedCheckpointRevision(value) {
      if (Number.isInteger(value)) checkpointRevision = Math.max(checkpointRevision, value);
      return checkpointRevision;
    }

    function currentCheckpointRevision() {
      return checkpointRevision;
    }

    function readHandledIds() {
      const raw = safeRead(handledKey);
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.filter(id => typeof id === 'string' && id);
        }
        if (typeof parsed === 'string' && parsed) return [parsed];
      } catch { /* legacy values were stored as a plain session id */ }
      return [raw];
    }

    function markHandled(id) {
      if (!id) return;
      const ids = readHandledIds().filter(existing => existing !== id);
      ids.push(id);
      safeWrite(handledKey, JSON.stringify(ids.slice(-8)));
    }

    function isHandled(id) {
      return !!id && readHandledIds().includes(id);
    }

    function clearHandled(id) {
      if (!id) {
        safeRemove(handledKey);
        return;
      }
      const remaining = readHandledIds().filter(existing => existing !== id);
      if (remaining.length > 0) safeWrite(handledKey, JSON.stringify(remaining));
      else safeRemove(handledKey);
    }

    function writeScrollY(y) {
      safeWrite(scrollKey, String(y));
    }

    function readScrollY() {
      const raw = safeRead(scrollKey);
      if (raw == null) return null;
      const n = parseFloat(raw);
      return isFinite(n) ? n : null;
    }

    function clearScrollY() {
      safeRemove(scrollKey);
    }

    return {
      owner,
      sessionKey,
      handledKey,
      scrollKey,
      saveSession,
      loadSession,
      clearSession,
      nextCheckpointRevision,
      seedCheckpointRevision,
      currentCheckpointRevision,
      markHandled,
      isHandled,
      clearHandled,
      writeScrollY,
      readScrollY,
      clearScrollY,
    };
  }

  root.__IMPECCABLE_LIVE_SESSION__ = { createLiveBrowserSessionState };
})(typeof window !== 'undefined' ? window : globalThis);
